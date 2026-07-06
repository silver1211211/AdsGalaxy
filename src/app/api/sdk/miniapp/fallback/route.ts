/* eslint-disable @typescript-eslint/no-explicit-any -- legacy mediation query results are not schema-generated */
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  createMediationAttempt,
  getMediationRequestForFallback,
  isFallbackErrorCode,
  readAttemptState,
  recordMiniappNetworkFailure,
} from "@/lib/miniappMediationEngine";
import { isMiniAppNetworkName, type MiniAppAdFormat } from "@/lib/miniappNetworkAdapters";
import { toPublicMediationDecision } from "@/lib/publicMiniappSdk";
import { publicSdkErrorResponse, requirePublicSdkUser } from "@/lib/publicSdkAuth";
import { isMiniappNetworkGloballyDisabled, requireAdServingAllowed } from "@/lib/productionSafety";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return new Response(null, { status: 204 });
}

function clean(value: unknown) {
  return String(value || "").trim();
}

function normalizeAdFormat(value: string): MiniAppAdFormat {
  return value === "interstitial" || value === "banner" ? value : "rewarded";
}

export async function POST(request: Request) {
  const conn = await pool.getConnection();
  try {
    const blocked = await requireAdServingAllowed();
    if (blocked) return blocked;

    const body = await request.json().catch(() => ({}));
    const miniappId = Number(body.miniapp_id);
    const sdkUser = await requirePublicSdkUser(request, miniappId, clean(body.telegram_user_id));
    const requestId = clean(body.request_id);
    const errorCode = clean(body.error_code) || "NETWORK_ERROR";
    const errorMessage = clean(body.error_message) || "Ad source failed";
    if (!requestId) {
      return NextResponse.json({ success: false, error_code: "REQUEST_FAILED", message: "request_id is required" }, { status: 400 });
    }
    if (!isFallbackErrorCode(errorCode)) {
      return NextResponse.json({ success: false, error_code: "NO_FILL", message: "No advertisements are available at the moment. Please try again shortly." });
    }

    await conn.beginTransaction();
    const mediationRequest: any = await getMediationRequestForFallback(requestId, conn);
    if (!mediationRequest) {
      await conn.rollback();
      return NextResponse.json({ success: false, error_code: "REQUEST_FAILED", message: "Ad request not found" }, { status: 404 });
    }
    if (Number(mediationRequest.miniapp_id) !== miniappId) {
      await conn.rollback();
      return NextResponse.json({ success: false, error_code: "INVALID_APP", message: "Ad request does not belong to this Mini App" }, { status: 403 });
    }
    if (String(mediationRequest.telegram_user_id) !== sdkUser.telegramUserId) {
      await conn.rollback();
      return NextResponse.json({ success: false, error_code: "INVALID_INIT_DATA", message: "Ad request does not match this user" }, { status: 403 });
    }
    if (String(mediationRequest.final_result) !== "selected") {
      await conn.rollback();
      return NextResponse.json({ success: false, error_code: "REQUEST_FAILED", message: "Fallback was already processed" }, { status: 409 });
    }
    if (!isMiniAppNetworkName(String(mediationRequest.selected_network))) {
      await conn.rollback();
      return NextResponse.json({ success: false, error_code: "NO_FILL", message: "No advertisements are available at the moment. Please try again shortly." });
    }

    await recordMiniappNetworkFailure({
      conn,
      miniappId: Number(mediationRequest.miniapp_id),
      networkName: mediationRequest.selected_network,
      requestId,
      errorCode,
      errorMessage,
      adFormat: mediationRequest.ad_format || "rewarded",
    });
    await conn.query("UPDATE miniapp_mediation_requests SET final_result = 'failed' WHERE request_id = ?", [requestId]);

    const state = readAttemptState(mediationRequest);
    const attemptedNetworks = Array.from(new Set([...state.attemptedNetworks, mediationRequest.selected_network]));
    const nextDecision = await createMediationAttempt({
      conn,
      miniappId: Number(mediationRequest.miniapp_id),
      telegramUserId: String(mediationRequest.telegram_user_id),
      country: mediationRequest.country,
      adFormat: normalizeAdFormat(mediationRequest.ad_format),
      parentRequestId: requestId,
      rootRequestId: state.rootRequestId || requestId,
      alreadyAttempted: attemptedNetworks,
      fallbackAttempts: [...state.fallbackAttempts, { error_code: errorCode, at: new Date().toISOString() }],
    });
    if (await isMiniappNetworkGloballyDisabled(nextDecision.selected_network, conn)) {
      await conn.commit();
      return NextResponse.json({
        success: false,
        error_code: "NO_FILL",
        message: "No advertisements are available at the moment. Please try again shortly.",
        request_id: nextDecision.request_id,
        fallback_available: false,
        ad_format: nextDecision.ad_format,
        decision_reason: "globally_disabled",
      });
    }
    await conn.commit();
    return NextResponse.json(toPublicMediationDecision(nextDecision));
  } catch (error: any) {
    try {
      await conn.rollback();
    } catch {}
    console.error("Public SDK Mini App fallback failed", error);
    return NextResponse.json(
      { ...publicSdkErrorResponse(error, "REQUEST_FAILED", "Fallback failed"), message: "Network temporarily unavailable." },
      { status: Number(error?.status || 400) }
    );
  } finally {
    conn.release();
  }
}
