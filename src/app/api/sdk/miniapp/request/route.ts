import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { createMediationAttempt } from "@/lib/miniappMediationEngine";
import { recordMiniappAdOpportunity } from "@/lib/miniappMonetagProtection";
import { toPublicMediationDecision } from "@/lib/publicMiniappSdk";
import type { MiniAppAdFormat } from "@/lib/miniappNetworkAdapters";
import { publicSdkErrorResponse, requirePublicSdkUser } from "@/lib/publicSdkAuth";
import { isMiniappNetworkGloballyDisabled, requireAdServingAllowed } from "@/lib/productionSafety";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new Response(null, { status: 204 });
}

function clean(value: unknown) {
  return String(value || "").trim();
}

function normalizeAdFormat(value: unknown): MiniAppAdFormat {
  const adFormat = clean(value) || "rewarded";
  return adFormat === "interstitial" || adFormat === "banner" ? adFormat : "rewarded";
}

function normalizeCountry(value: unknown) {
  const country = clean(value).toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : null;
}

export async function POST(request: Request) {
  const conn = await pool.getConnection();
  try {
    const blocked = await requireAdServingAllowed();
    if (blocked) return blocked;

    const body = await request.json().catch(() => ({}));
    const miniappId = Number(body.miniapp_id);
    const sdkUser = await requirePublicSdkUser(request);
    const suppliedUserId = clean(body.telegram_user_id);
    if (suppliedUserId && suppliedUserId !== sdkUser.telegramUserId) {
      return NextResponse.json({ success: false, error_code: "INVALID_INIT_DATA", message: "telegram_user_id does not match authenticated user" }, { status: 403 });
    }
    const telegramUserId = sdkUser.telegramUserId;
    const adFormat = normalizeAdFormat(body.ad_format);
    const country = normalizeCountry(body.country);

    if (!Number.isInteger(miniappId) || miniappId <= 0) {
      return NextResponse.json({ success: false, error_code: "INVALID_APP", message: "Valid Mini App ID is required" }, { status: 400 });
    }
    const [[rateRow]]: any = await pool.query(
      "SELECT COUNT(*) AS count FROM miniapp_mediation_requests WHERE telegram_user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 MINUTE)",
      [telegramUserId]
    );
    if (Number(rateRow?.count || 0) >= 30) {
      return NextResponse.json({ success: false, error_code: "RATE_LIMITED", message: "Too many ad requests. Try again shortly." }, { status: 429 });
    }

    const [miniapps]: any = await pool.query(
      "SELECT id, status, is_deleted FROM miniapps WHERE id = ? LIMIT 1",
      [miniappId]
    );
    if (!miniapps[0] || Boolean(miniapps[0].is_deleted)) {
      return NextResponse.json({ success: false, error_code: "INVALID_APP", message: "Mini App not found" }, { status: 404 });
    }
    if (miniapps[0].status !== "approved" && miniapps[0].status !== "monetized") {
      return NextResponse.json({ success: false, error_code: "APP_NOT_READY", message: "Mini App is not ready for ads" }, { status: 403 });
    }

    await conn.beginTransaction();
    await recordMiniappAdOpportunity(miniappId, telegramUserId, conn);
    const decision = await createMediationAttempt({ conn, miniappId, telegramUserId, country, adFormat });
    if (await isMiniappNetworkGloballyDisabled(decision.selected_network, conn)) {
      await conn.commit();
      return NextResponse.json({
        success: false,
        error_code: "NO_FILL",
        message: "No ad available right now.",
        request_id: decision.request_id,
        enabled_networks: decision.enabled_networks,
        candidate_networks: decision.candidate_networks,
        skipped_networks: [...decision.skipped_networks, { network_name: decision.selected_network, reason: "globally_disabled" }],
        ad_format: decision.ad_format,
        decision_reason: "globally_disabled",
      });
    }
    await conn.commit();

    return NextResponse.json(toPublicMediationDecision(decision));
  } catch (error: any) {
    try {
      await conn.rollback();
    } catch {}
    return NextResponse.json(publicSdkErrorResponse(error), { status: Number(error?.status || 400) });
  } finally {
    conn.release();
  }
}
