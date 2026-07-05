import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { appendClickId, recordAdClick } from "@/lib/conversionTracking";
import { requireMiniappTrackingUser } from "@/lib/publicSdkAuth";

export function OPTIONS() {
  return new Response(null, { status: 204 });
}

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const campaignType = clean(body.campaign_type) === "miniapp" ? "miniapp" : "campaign";
    const campaignId = Number(body.campaign_id);
    const miniappId = Number(body.miniapp_id || 0);
    const requestId = clean(body.request_id);
    const sessionId = clean(body.session_id);

    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return NextResponse.json({ error: "Valid campaign_id is required" }, { status: 400 });
    }

    const initData = request.headers.get("x-telegram-init-data");

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "127.0.0.1";
    const userAgent = request.headers.get("user-agent") || "unknown";

    if (campaignType === "miniapp") {
      if (!requestId || !Number.isInteger(miniappId) || miniappId <= 0) {
        return NextResponse.json({ error: "request_id and miniapp_id are required" }, { status: 400 });
      }
      const trackingUser = await requireMiniappTrackingUser(request, miniappId);
      const [requestRows]: any = await pool.query(
        `SELECT miniapp_id, telegram_user_id, internal_campaign_id
         FROM miniapp_mediation_requests WHERE request_id = ? LIMIT 1`,
        [requestId]
      );
      const adRequest = requestRows[0];
      if (!adRequest
        || Number(adRequest.miniapp_id) !== miniappId
        || Number(adRequest.internal_campaign_id) !== campaignId
        || String(adRequest.telegram_user_id) !== trackingUser.telegramUserId) {
        return NextResponse.json({ error: "Click does not match the issued ad request" }, { status: 403 });
      }
      const [rows]: any = await pool.query(
        "SELECT id, advertiser_id, image_url, categories, landing_url FROM miniapp_rewarded_campaigns WHERE id = ?",
        [campaignId]
      );
      if (rows.length === 0) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
      const clickId = await recordAdClick({
        campaignType: "miniapp",
        campaignId,
        advertiserId: Number(rows[0].advertiser_id),
        creativeId: rows[0].image_url || null,
        category: rows[0].categories || null,
        inventoryType: "miniapp",
        inventoryId: miniappId || null,
        miniappId: miniappId || null,
        requestId: requestId || null,
        ipAddress: ip,
        userAgent,
        sessionId: sessionId || null,
      });
      return NextResponse.json({ success: true, click_id: clickId, url: appendClickId(rows[0].landing_url, clickId) });
    }

    if (initData) await getAuthenticatedUser(initData);

    const [rows]: any = await pool.query(
      "SELECT id, user_id, image_url, category, link FROM campaigns WHERE id = ?",
      [campaignId]
    );
    if (rows.length === 0) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    const clickId = await recordAdClick({
      campaignType: "campaign",
      campaignId,
      advertiserId: Number(rows[0].user_id),
      creativeId: rows[0].image_url || null,
      category: rows[0].category || null,
      inventoryType: clean(body.inventory_type) || null,
      inventoryId: Number(body.inventory_id || 0) || null,
      ipAddress: ip,
      userAgent,
      sessionId: sessionId || null,
    });
    return NextResponse.json({ success: true, click_id: clickId, url: appendClickId(rows[0].link, clickId) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to record click" }, { status: 400 });
  }
}
