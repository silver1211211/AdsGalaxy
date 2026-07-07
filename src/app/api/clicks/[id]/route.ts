import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import crypto from "crypto";
import { appendClickId, recordAdClick } from "@/lib/conversionTracking";
import { parsePositiveIntegerId } from "@/lib/routeIds";

async function recordCampaignClick(input: {
  campaignId: number;
  ip: string;
  userAgent: string;
  fingerprint: string;
  isBot: boolean;
}) {
  if (input.isBot) return false;

  const [existing]: any = await pool.query(
    "SELECT id FROM campaign_clicks WHERE campaign_id = ? AND fingerprint = ? AND created_at > NOW() - INTERVAL 1 DAY",
    [input.campaignId, input.fingerprint]
  );

  if (existing.length > 0) return false;

  await pool.query(
    "INSERT INTO campaign_clicks (campaign_id, ip_address, user_agent, fingerprint, is_bot) VALUES (?, ?, ?, ?, ?)",
    [input.campaignId, input.ip, input.userAgent, input.fingerprint, input.isBot]
  );
  return true;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: campaignId } = await params;
  const parsedCampaignId = parsePositiveIntegerId(campaignId);

  if (!parsedCampaignId) {
    console.warn("Malformed campaign click id rejected", { campaign_id: campaignId });
    return NextResponse.redirect(process.env.NEXT_PUBLIC_APP_URL || "/", 302);
  }
  
  // Get user info for tracking
  const ip = req.headers.get("x-forwarded-for")?.split(',')[0] || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";
  
  // Create a device fingerprint (simplified)
  const fingerprint = crypto
    .createHash("md5")
    .update(`${ip}-${userAgent}`)
    .digest("hex");

  let campaign: any;
  try {
    const [rows]: any = await pool.query(
      "SELECT id, user_id, link, image_url, category FROM campaigns WHERE id = ?",
      [parsedCampaignId]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    campaign = rows[0];
  } catch (error) {
    console.error("Click destination resolution failed", { campaign_id: parsedCampaignId, error: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.redirect(process.env.NEXT_PUBLIC_APP_URL || "/", 302);
  }

  let targetUrl = campaign.link;
  try {
    const isBot = /bot|spider|crawl|slurp|github-camo|googlebot|bingbot|yandex|baidu/i.test(userAgent);
    const clickRecorded = await recordCampaignClick({ campaignId: parsedCampaignId, ip, userAgent, fingerprint, isBot });
    if (clickRecorded) {
      const clickId = await recordAdClick({
        campaignType: "campaign",
        campaignId: Number(campaign.id),
        advertiserId: Number(campaign.user_id),
        creativeId: campaign.image_url || null,
        category: campaign.category || null,
        inventoryType: "direct",
        ipAddress: ip,
        userAgent,
        fingerprint,
      });
      targetUrl = appendClickId(targetUrl, clickId);
    }
  } catch (error) {
    console.error("Click tracking failed; redirect preserved", { campaign_id: parsedCampaignId, error: error instanceof Error ? error.message : "unknown_error" });
  }
  return NextResponse.redirect(targetUrl, 302);
}
