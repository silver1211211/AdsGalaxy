import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import crypto from "crypto";
import { appendClickId, recordAdClick } from "@/lib/conversionTracking";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { debitChannelClick } from "@/lib/channelFastBilling";
import { parsePositiveIntegerId } from "@/lib/routeIds";

type CampaignPostRow = RowDataPacket & {
  id: number;
  user_id: number;
  link: string;
  image_url: string | null;
  category: string | null;
  post_id: number;
  channel_id: number | null;
};

async function getCampaignClickColumns() {
  const [rows] = await pool.query<Array<RowDataPacket & { COLUMN_NAME: string }>>(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'campaign_clicks'
  `);

  return new Set(rows.map((row) => String(row.COLUMN_NAME)));
}

async function recordLegacyCampaignClick(input: {
  campaignId: number;
  postId: number;
  ip: string;
  userAgent: string;
  fingerprint: string;
  isBot: boolean;
}): Promise<{ id: number; isNew: boolean } | null> {
  if (input.isBot) return null;

  const columns = await getCampaignClickColumns();
  if (!columns.has("campaign_id")) return null;

  if (columns.has("post_id") && columns.has("fingerprint")) {
    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM campaign_clicks WHERE post_id = ? AND fingerprint = ? AND created_at > NOW() - INTERVAL 1 DAY",
      [input.postId, input.fingerprint]
    );

    if (existing.length > 0) return { id: Number(existing[0].id), isNew: false };
  } else if (columns.has("fingerprint")) {
    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM campaign_clicks WHERE campaign_id = ? AND fingerprint = ? AND created_at > NOW() - INTERVAL 1 DAY",
      [input.campaignId, input.fingerprint]
    );

    if (existing.length > 0) return { id: Number(existing[0].id), isNew: false };
  }

  const insertColumns = ["campaign_id"];
  const insertParams: Array<number | string | boolean> = [input.campaignId];

  if (columns.has("post_id")) {
    insertColumns.push("post_id");
    insertParams.push(input.postId);
  }
  if (columns.has("ip_address")) {
    insertColumns.push("ip_address");
    insertParams.push(input.ip);
  }
  if (columns.has("user_agent")) {
    insertColumns.push("user_agent");
    insertParams.push(input.userAgent);
  }
  if (columns.has("fingerprint")) {
    insertColumns.push("fingerprint");
    insertParams.push(input.fingerprint);
  }
  if (columns.has("is_bot")) {
    insertColumns.push("is_bot");
    insertParams.push(input.isBot);
  }

  const placeholders = insertColumns.map(() => "?").join(", ");
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO campaign_clicks (${insertColumns.join(", ")}) VALUES (${placeholders})`,
    insertParams
  );
  return { id: Number(result.insertId), isNew: true };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; postId: string }> }
) {
  const { id: rawCampaignId, postId: rawPostId } = await params;
  const campaignId = parsePositiveIntegerId(rawCampaignId);
  const postId = parsePositiveIntegerId(rawPostId);
  
  // 1. Validate both IDs are present
  if (!campaignId || !postId) {
    // If anything is missing, we still redirect for UX, but do NOT save
    console.warn("Malformed campaign post click ids rejected", { campaign_id: rawCampaignId, post_id: rawPostId });
    return redirectToFallback();
  }

  const ip = req.headers.get("x-forwarded-for")?.split(',')[0] || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";
  
  const fingerprint = crypto
    .createHash("md5")
    .update(`${ip}-${userAgent}`)
    .digest("hex");

  let campaignPost: CampaignPostRow | null = null;
  let targetUrl: string;
  try {
    const [rows] = await pool.query<CampaignPostRow[]>(
      `SELECT c.id, c.user_id, c.link, c.image_url, c.category, cp.id as post_id, cp.channel_id
       FROM campaigns c 
       JOIN campaign_posts cp ON cp.campaign_id = c.id
       WHERE c.id = ? AND cp.id = ?`,
      [campaignId, postId]
    );

    if (rows.length > 0) {
      campaignPost = rows[0];
      targetUrl = rows[0].link;
    } else {
      const [campOnly] = await pool.query<Array<RowDataPacket & { link: string }>>("SELECT link FROM campaigns WHERE id = ?", [campaignId]);
      if (campOnly.length > 0) {
        return NextResponse.redirect(campOnly[0].link, 302);
      }
      return NextResponse.redirect(process.env.NEXT_PUBLIC_APP_URL || "/", 302);
    }
  } catch (error) {
    console.error("Click destination resolution failed", { campaign_id: campaignId, post_id: postId, error: error instanceof Error ? error.message : "unknown_error" });
    try {
      const [campaignRows] = await pool.query<Array<RowDataPacket & { link: string }>>("SELECT link FROM campaigns WHERE id = ?", [campaignId]);
      if (campaignRows[0]?.link) return NextResponse.redirect(campaignRows[0].link, 302);
    } catch (fallbackError) {
      console.error("Click destination fallback failed", { campaign_id: campaignId, error: fallbackError instanceof Error ? fallbackError.message : "unknown_error" });
    }
    return redirectToFallback();
  }

  try {
    const isBot = /bot|spider|crawl|slurp|github-camo|googlebot|bingbot|yandex|baidu/i.test(userAgent);
    const clickRecorded = await recordLegacyCampaignClick({ campaignId, postId, ip, userAgent, fingerprint, isBot });

    if (clickRecorded && campaignPost) {
      await debitChannelClick(Number(postId), clickRecorded.id);
    }
    if (clickRecorded?.isNew && campaignPost) {
      const clickId = await recordAdClick({
        campaignType: "campaign",
        campaignId: Number(campaignPost.id),
        advertiserId: Number(campaignPost.user_id),
        creativeId: campaignPost.image_url || null,
        category: campaignPost.category || null,
        inventoryType: "channel",
        inventoryId: Number(campaignPost.channel_id || 0) || null,
        postId: Number(campaignPost.post_id),
        ipAddress: ip,
        userAgent,
        fingerprint,
      });
      targetUrl = appendClickId(targetUrl, clickId);
    }
  } catch (error) {
    console.error("Click tracking failed; redirect preserved", { campaign_id: campaignId, post_id: postId, error: error instanceof Error ? error.message : "unknown_error" });
  }
  return NextResponse.redirect(targetUrl, 302);
}

function redirectToFallback() {
  // Safe fallback if IDs missing
  return NextResponse.redirect(process.env.NEXT_PUBLIC_APP_URL || "/", 302);
}
