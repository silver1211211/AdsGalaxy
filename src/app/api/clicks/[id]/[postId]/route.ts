import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import crypto from "crypto";
import { appendClickId, recordAdClick } from "@/lib/conversionTracking";
import type { RowDataPacket } from "mysql2/promise";

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
  campaignId: string;
  postId: string;
  ip: string;
  userAgent: string;
  fingerprint: string;
  isBot: boolean;
}) {
  if (input.isBot) return;

  const columns = await getCampaignClickColumns();
  if (!columns.has("campaign_id")) return;

  if (columns.has("post_id") && columns.has("fingerprint")) {
    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM campaign_clicks WHERE post_id = ? AND fingerprint = ? AND created_at > NOW() - INTERVAL 1 DAY",
      [input.postId, input.fingerprint]
    );

    if (existing.length > 0) return;
  } else if (columns.has("fingerprint")) {
    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM campaign_clicks WHERE campaign_id = ? AND fingerprint = ? AND created_at > NOW() - INTERVAL 1 DAY",
      [input.campaignId, input.fingerprint]
    );

    if (existing.length > 0) return;
  }

  const insertColumns = ["campaign_id"];
  const insertParams: Array<string | boolean> = [input.campaignId];

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
  await pool.query(
    `INSERT INTO campaign_clicks (${insertColumns.join(", ")}) VALUES (${placeholders})`,
    insertParams
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; postId: string }> }
) {
  const { id: campaignId, postId } = await params;
  
  // 1. Validate both IDs are present
  if (!campaignId || !postId) {
    // If anything is missing, we still redirect for UX, but do NOT save
    return redirectToFallback();
  }

  const ip = req.headers.get("x-forwarded-for")?.split(',')[0] || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";
  
  const fingerprint = crypto
    .createHash("md5")
    .update(`${ip}-${userAgent}`)
    .digest("hex");

  try {
    // 2. Verify campaign exists AND the post belongs to this campaign
    const [rows] = await pool.query<CampaignPostRow[]>(
      `SELECT c.id, c.user_id, c.link, c.image_url, c.category, cp.id as post_id, cp.channel_id
       FROM campaigns c 
       JOIN campaign_posts cp ON cp.campaign_id = c.id
       WHERE c.id = ? AND cp.id = ?`,
      [campaignId, postId]
    );

    if (rows.length === 0) {
      // If no match found, redirect to a safe fallback or original link if possible
      // But don't record the click
      const [campOnly] = await pool.query<Array<RowDataPacket & { link: string }>>("SELECT link FROM campaigns WHERE id = ?", [campaignId]);
      if (campOnly.length > 0) {
        return NextResponse.redirect(campOnly[0].link, 302);
      }
      return NextResponse.redirect(process.env.NEXT_PUBLIC_APP_URL || "/", 302);
    }

    let targetUrl = rows[0].link;

    // Persist the settlement source record before redirecting. An unawaited write
    // can be terminated by serverless runtimes and silently lose valid clicks.
    const isBot = /bot|spider|crawl|slurp|github-camo|googlebot|bingbot|yandex|baidu/i.test(userAgent);
    await recordLegacyCampaignClick({ campaignId, postId, ip, userAgent, fingerprint, isBot });

    if (!isBot) {
      const clickId = await recordAdClick({
        campaignType: "campaign",
        campaignId: Number(rows[0].id),
        advertiserId: Number(rows[0].user_id),
        creativeId: rows[0].image_url || null,
        category: rows[0].category || null,
        inventoryType: "channel",
        inventoryId: Number(rows[0].channel_id || 0) || null,
        postId: Number(rows[0].post_id),
        ipAddress: ip,
        userAgent,
        fingerprint,
      });
      targetUrl = appendClickId(targetUrl, clickId);
    }

    return NextResponse.redirect(targetUrl, 302);
  } catch (error) {
    console.error("Click Tracking Error:", error);
    return NextResponse.redirect(process.env.NEXT_PUBLIC_APP_URL || "/", 302);
  }
}

function redirectToFallback() {
  // Safe fallback if IDs missing
  return NextResponse.redirect(process.env.NEXT_PUBLIC_APP_URL || "/", 302);
}
