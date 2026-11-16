import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import crypto from "crypto";
import { appendClickId, recordAdClick } from "@/lib/conversionTracking";
import type { RowDataPacket } from "mysql2/promise";
import { debitChannelClick } from "@/lib/channelFastBilling";
import { acceptChannelCampaignClick } from "@/lib/channelAcceptedEngagement";
import { parsePositiveIntegerId } from "@/lib/routeIds";
import { recordChannelTrafficEvent, telemetryCountry } from "@/lib/channelTrafficTelemetry";
import { safeCampaignDestination } from "@/lib/clickDestination";
import { decryptPrivateInviteLink } from "@/lib/privateInviteLinkVault";
import { isBillablePublishedPlacement } from "@/lib/campaignCreativeRevision";

type CampaignPostRow = RowDataPacket & {
  id: number;
  user_id: number;
  link: string;
  image_url: string | null;
  category: string | null;
  campaign_kind: string | null;
  post_id: number;
  channel_id: number | null;
  approved_destination_url: string | null;
  campaign_status: string;
  post_status: string;
  pause_reason: string | null;
  status_before_creative_review: string | null;
  approved_creative_revision_id: number | null;
  pending_creative_revision_id: number | null;
  delivery_confirmed_at: Date | null;
  deleted_at: Date | null;
};

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
      `SELECT c.id, c.user_id, c.link, c.image_url, c.category, c.campaign_kind,
         c.status campaign_status,c.pause_reason,c.status_before_creative_review,
         c.approved_creative_revision_id,c.pending_creative_revision_id,
         cp.id as post_id, cp.channel_id,cp.status post_status,cp.delivery_confirmed_at,
         cp.deleted_at,cp.approved_destination_url
       FROM campaigns c 
       JOIN campaign_posts cp ON cp.campaign_id = c.id
       WHERE COALESCE(c.public_id,c.id) = ? AND cp.id = ?
         AND cp.delivery_confirmed_at IS NOT NULL AND cp.delivery_failed_at IS NULL
         AND cp.deleted_at IS NULL
         AND cp.delivery_confirmed_at>DATE_SUB(UTC_TIMESTAMP(),INTERVAL 24 HOUR)`,
      [campaignId, postId]
    );

    if (rows.length > 0) {
      campaignPost = rows[0];
      if (!isBillablePublishedPlacement({
        campaignStatus: campaignPost.campaign_status, pauseReason: campaignPost.pause_reason,
        priorStatus: campaignPost.status_before_creative_review,
        approvedRevisionId: campaignPost.approved_creative_revision_id,
        pendingRevisionId: campaignPost.pending_creative_revision_id,
        placementStatus: campaignPost.post_status,
        deliveryConfirmed: Boolean(campaignPost.delivery_confirmed_at),
        deleted: Boolean(campaignPost.deleted_at),
      }) && campaignPost.campaign_kind !== "channel_growth") return redirectToFallback();
      const approvedUrl = campaignPost.approved_destination_url ||
        (campaignPost.campaign_status === "active" && !campaignPost.pending_creative_revision_id
          && !campaignPost.approved_creative_revision_id
          ? campaignPost.link : null);
      targetUrl = safeCampaignDestination(approvedUrl) || fallbackUrl();
      if (campaignPost.campaign_kind !== "channel_growth" && (!approvedUrl || targetUrl === fallbackUrl())) return redirectToFallback();
      if (campaignPost.campaign_kind === "channel_growth" && req.nextUrl.searchParams.get("growth") === "1") {
        const [invites] = await pool.query<Array<RowDataPacket & { invite_link_encrypted: string }>>(
          "SELECT invite_link_encrypted FROM channel_growth_invites WHERE campaign_post_id=? AND campaign_id=? AND status='active' LIMIT 1",
          [postId, campaignPost.id],
        );
        const inviteUrl = decryptPrivateInviteLink(invites[0]?.invite_link_encrypted);
        if (inviteUrl) targetUrl = inviteUrl;
      }
    } else {
      return redirectToFallback();
    }
  } catch (error) {
    console.error("Click destination resolution failed", { campaign_id: campaignId, post_id: postId, error: error instanceof Error ? error.message : "unknown_error" });
    return redirectToFallback();
  }

  let clickRecorded: { id: number; isNew: boolean } | null = null;
  const isBot = /bot|spider|crawl|slurp|github-camo|googlebot|bingbot|yandex|baidu/i.test(userAgent);
  try {
    clickRecorded = await acceptChannelCampaignClick(pool, { campaignId:Number(campaignPost?.id||0), postId, ip, userAgent, fingerprint, isBot });
    if (!clickRecorded && !isBot) return redirectToFallback();
  } catch (error) {
    console.error("Click acceptance failed", { campaign_id: campaignId, post_id: postId, error: error instanceof Error ? error.message : "unknown_error" });
    return redirectToFallback();
  }
  try {
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
    console.error("Click billing or tracking failed; accepted redirect preserved", { campaign_id: campaignId, post_id: postId, error: error instanceof Error ? error.message : "unknown_error" });
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
