import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import crypto from "crypto";
import { appendClickId, recordAdClick } from "@/lib/conversionTracking";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { debitChannelClick } from "@/lib/channelFastBilling";
import { parsePositiveIntegerId } from "@/lib/routeIds";
import { recordChannelTrafficEvent, telemetryCountry } from "@/lib/channelTrafficTelemetry";
import { safeCampaignDestination } from "@/lib/clickDestination";
import { decryptPrivateInviteLink } from "@/lib/privateInviteLinkVault";
import { cachedClickDestination, rememberClickDestination } from "@/lib/clickDestinationCache";

type CampaignPostRow = RowDataPacket & {
  id: number;
  user_id: number;
  link: string;
  image_url: string | null;
  category: string | null;
  campaign_kind: string | null;
  post_id: number;
  channel_id: number | null;
};

async function recordLegacyCampaignClick(input: {
  campaignId: number;
  postId: number;
  ip: string;
  userAgent: string;
  fingerprint: string;
  isBot: boolean;
}): Promise<{ id: number; isNew: boolean } | null> {
  if (input.isBot) return null;

  // campaign_clicks is a canonical deployed schema. Never perform INFORMATION_SCHEMA discovery on redirects.
  const [existing] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM campaign_clicks WHERE post_id = ? AND fingerprint = ? AND created_at > NOW() - INTERVAL 1 DAY",
    [input.postId, input.fingerprint]
  );
  if (existing.length > 0) return { id: Number(existing[0].id), isNew: false };
  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO campaign_clicks (campaign_id,post_id,ip_address,user_agent,fingerprint,is_bot) VALUES (?,?,?,?,?,?)",
    [input.campaignId, input.postId, input.ip, input.userAgent, input.fingerprint, input.isBot]
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

  const destinationStartedAt = Date.now();
  let campaignPost: CampaignPostRow | null = null;
  let targetUrl: string;
  try {
    const [rows] = await pool.query<CampaignPostRow[]>(
      `SELECT c.id, c.user_id, c.link, c.image_url, c.category, c.campaign_kind, cp.id as post_id, cp.channel_id
       FROM campaigns c 
       JOIN campaign_posts cp ON cp.campaign_id = c.id
       WHERE COALESCE(c.public_id,c.id) = ? AND cp.id = ?`,
      [campaignId, postId]
    );

    if (rows.length > 0) {
      campaignPost = rows[0];
      targetUrl = safeCampaignDestination(rows[0].link) || fallbackUrl();
      // Do not cache private invite destinations; cache is server-authoritative normal campaign metadata only.
      if (campaignPost.campaign_kind !== "channel_growth") rememberClickDestination(campaignId, postId, campaignPost.id, targetUrl);
      if (campaignPost.campaign_kind === "channel_growth" && req.nextUrl.searchParams.get("growth") === "1") {
        const [invites] = await pool.query<Array<RowDataPacket & { invite_link_encrypted: string }>>(
          "SELECT invite_link_encrypted FROM channel_growth_invites WHERE campaign_post_id=? AND campaign_id=? AND status='active' LIMIT 1",
          [postId, campaignPost.id],
        );
        const inviteUrl = decryptPrivateInviteLink(invites[0]?.invite_link_encrypted);
        if (inviteUrl) targetUrl = inviteUrl;
      }
    } else {
      const [campOnly] = await pool.query<Array<RowDataPacket & { link: string }>>("SELECT link FROM campaigns WHERE COALESCE(public_id,id) = ?", [campaignId]);
      return NextResponse.redirect(safeCampaignDestination(campOnly[0]?.link) || fallbackUrl(), 302);
    }
  } catch (error) {
    console.error("Click destination resolution failed", { campaign_id: campaignId, post_id: postId, error: error instanceof Error ? error.message : "unknown_error" });
    const cached = cachedClickDestination(campaignId, postId);
    if (cached) {
      console.warn("click_redirect_cached_destination", { campaign_id: campaignId, post_id: postId, destination_lookup_ms: Date.now() - destinationStartedAt, failure_class: "destination_db_failure" });
      return NextResponse.redirect(cached.targetUrl, 302);
    }
    try {
      const [campaignRows] = await pool.query<Array<RowDataPacket & { link: string }>>("SELECT link FROM campaigns WHERE COALESCE(public_id,id) = ?", [campaignId]);
      const destination = safeCampaignDestination(campaignRows[0]?.link);
      if (destination) return NextResponse.redirect(destination, 302);
    } catch (fallbackError) {
      console.error("Click destination fallback failed", { campaign_id: campaignId, error: fallbackError instanceof Error ? fallbackError.message : "unknown_error" });
    }
    return redirectToFallback();
  }

  let clickRecorded: { id: number; isNew: boolean } | null = null;
  try {
    const isBot = /bot|spider|crawl|slurp|github-camo|googlebot|bingbot|yandex|baidu/i.test(userAgent);
    clickRecorded = await recordLegacyCampaignClick({ campaignId:Number(campaignPost?.id||0), postId, ip, userAgent, fingerprint, isBot });

    if (clickRecorded && campaignPost && campaignPost.campaign_kind !== "channel_growth") {
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
      if (campaignPost.campaign_kind !== "channel_growth") targetUrl = appendClickId(targetUrl, clickId);
    }
  } catch (error) {
    console.error("Click tracking failed; redirect preserved", { campaign_id: campaignId, post_id: postId, error: error instanceof Error ? error.message : "unknown_error" });
  }
  if (campaignPost?.channel_id) {
    try {
      const requestKey = req.headers.get("x-request-id") || ["channel-click", campaignId, postId, fingerprint, Math.floor(Date.now() / 300_000)].join(":");
      await recordChannelTrafficEvent({
        eventKey: requestKey,
        eventType: "click",
        channelId: Number(campaignPost.channel_id),
        campaignId:Number(campaignPost.id),
        postId,
        ip,
        userAgent,
        sessionId: req.cookies.get("session_id")?.value || req.cookies.get("user_session")?.value,
        fingerprint,
        country: telemetryCountry(req.headers),
        duplicate: Boolean(clickRecorded && !clickRecorded.isNew),
      });
    } catch (error) {
      console.error("Channel telemetry failed; click flow preserved", { campaign_id: campaignId, post_id: postId, error: error instanceof Error ? error.message : "unknown_error" });
    }
  }
  console.info("click_redirect", JSON.stringify({ campaign_id: campaignId, post_id: postId, destination_lookup_ms: Date.now() - destinationStartedAt, record_result: clickRecorded ? (clickRecorded.isNew ? "new" : "duplicate") : "unrecorded", redirect_result: "advertiser_destination" }));
  return NextResponse.redirect(targetUrl, 302);
}

function fallbackUrl() {
  return safeCampaignDestination(process.env.NEXT_PUBLIC_APP_URL) || "https://app.adsgalaxy.online/";
}
function redirectToFallback() {
  // Safe fallback if IDs missing
  return NextResponse.redirect(fallbackUrl(), 302);
}
