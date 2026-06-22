import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import {
  createMediationAttempt,
  getMediationRequestForFallback,
  isFallbackErrorCode,
  readAttemptState,
  recordMiniappNetworkFailure,
} from "@/lib/miniappMediationEngine";
import { isMiniAppNetworkName, type MiniAppAdFormat } from "@/lib/miniappNetworkAdapters";
import { assertMiniAppOwnerBetaAccess, MiniAppBetaAccessError } from "@/lib/miniappBetaAccess";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeAdFormat(value: string): MiniAppAdFormat {
  if (value === "rewarded" || value === "interstitial" || value === "banner") return value;
  return "rewarded";
}

export async function POST(request: Request) {
  const conn = await pool.getConnection();

  try {
    const body = await request.json();
    const requestId = cleanText(body.request_id);
    const failedNetwork = cleanText(body.failed_network);
    const errorCode = cleanText(body.error_code) || "NETWORK_ERROR";
    const errorMessage = cleanText(body.error_message) || "Network failed";

    if (!requestId) {
      return NextResponse.json({ error: "request_id is required" }, { status: 400 });
    }

    if (!isMiniAppNetworkName(failedNetwork)) {
      return NextResponse.json({ error: "failed_network is invalid" }, { status: 400 });
    }

    if (!isFallbackErrorCode(errorCode)) {
      return NextResponse.json({
        success: false,
        error_code: "NO_FILL",
        message: "No ad available right now.",
        decision_reason: "non_fallback_error",
      });
    }

    await conn.beginTransaction();

    const mediationRequest = await getMediationRequestForFallback(requestId, conn);
    if (!mediationRequest) {
      await conn.rollback();
      return NextResponse.json({ error: "Mediation request not found" }, { status: 404 });
    }

    const initData = request.headers.get("x-telegram-init-data");
    if (!initData) {
      await conn.rollback();
      return NextResponse.json({ error: "Unauthorized: initData required" }, { status: 401 });
    }

    const authenticatedUser = await getAuthenticatedUser(initData);
    if (String(authenticatedUser.telegram_id) !== String(mediationRequest.telegram_user_id)) {
      await conn.rollback();
      return NextResponse.json({ error: "telegram_user_id does not match authenticated user" }, { status: 403 });
    }

    await assertMiniAppOwnerBetaAccess(mediationRequest.miniapp_id, conn);

    await recordMiniappNetworkFailure({
      conn,
      miniappId: Number(mediationRequest.miniapp_id),
      networkName: failedNetwork,
      requestId,
      errorCode,
      errorMessage,
      adFormat: mediationRequest.ad_format || "rewarded",
    });

    await conn.query(
      "UPDATE miniapp_mediation_requests SET final_result = 'failed' WHERE request_id = ?",
      [requestId]
    );

    const state = readAttemptState(mediationRequest);
    const attemptedNetworks = Array.from(new Set([...state.attemptedNetworks, failedNetwork]));
    const fallbackAttempts = [
      ...state.fallbackAttempts,
      {
        network_name: failedNetwork,
        error_code: errorCode,
        error_message: errorMessage.slice(0, 160),
        at: new Date().toISOString(),
      },
    ];

    const nextDecision = await createMediationAttempt({
      conn,
      miniappId: Number(mediationRequest.miniapp_id),
      telegramUserId: String(mediationRequest.telegram_user_id),
      country: mediationRequest.country,
      adFormat: normalizeAdFormat(mediationRequest.ad_format),
      parentRequestId: requestId,
      rootRequestId: state.rootRequestId || requestId,
      alreadyAttempted: attemptedNetworks,
      fallbackAttempts,
    });

    await conn.commit();

    if (!nextDecision.success) {
      return NextResponse.json({
        success: false,
        error_code: "NO_FILL",
        message: "No ad available right now.",
        request_id: nextDecision.request_id,
        enabled_networks: nextDecision.enabled_networks,
        attempted_networks: nextDecision.attempted_networks,
        skipped_networks: nextDecision.skipped_networks,
        fallback_attempts: nextDecision.fallback_attempts,
        fallback_available: false,
        ad_format: nextDecision.ad_format,
        decision_reason: nextDecision.decision_reason,
      });
    }

    return NextResponse.json({
      success: true,
      selected_network: nextDecision.selected_network,
      network_placement_id: nextDecision.network_placement_id || "",
      internal_ad: nextDecision.internal_ad || null,
      enabled_networks: nextDecision.enabled_networks,
      candidate_networks: nextDecision.candidate_networks,
      attempted_networks: nextDecision.attempted_networks,
      skipped_networks: nextDecision.skipped_networks,
      fallback_attempts: nextDecision.fallback_attempts,
      fallback_available: nextDecision.fallback_available,
      request_id: nextDecision.request_id,
      ad_format: nextDecision.ad_format,
      decision_reason: nextDecision.decision_reason,
    });
  } catch (error: any) {
    try {
      await conn.rollback();
    } catch {
      // Transaction may not have started.
    }

    const message = error?.message || "Failed to create mediation fallback";
    const status = error instanceof MiniAppBetaAccessError
      ? 403
      : message.startsWith("Unauthorized") || message.startsWith("Invalid initData")
        ? 401
        : 400;
    return NextResponse.json({ error: message }, { status });
  } finally {
    conn.release();
  }
}
