/* eslint-disable @typescript-eslint/no-explicit-any -- legacy authenticated request errors are normalized below */
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { INTERNAL_NETWORK_NAME, internalAdCooldownLockName, recordInternalAdImpression } from "@/lib/miniappInternalAds";
import { recordNetworkSuccess } from "@/lib/miniappOptimization";
import { requireMiniappTrackingUser } from "@/lib/publicSdkAuth";
import {
  isCompletionEvent,
  normalizeWatchDuration,
  qualityScoreForWatchTier,
  recordInternalAdCompletionEvent,
  watchDurationQualityTier,
} from "@/lib/internalAdCompletionQuality";
import {
  createRewardEvent,
  getActiveProductionBindingForMiniapp,
  productionRewardCallbacksEnabled,
} from "@/lib/miniappRewardEvents";
import { enqueueProductionRewardWebhook } from "@/lib/developerPlatform";
import { enqueueDirectMiniappRewardCallback } from "@/lib/miniappDirectRewardCallbacks";
import { dispatchMiniAppCampaignNotifications } from "@/lib/miniappCampaignNotifications";
import { miniAppEconomicIdentity, trustedMiniAppCountry } from "@/lib/miniappEconomicTelemetry";

type RequestRow = RowDataPacket & {
  id: number;
  miniapp_id: number;
  telegram_user_id: string | number;
  country: string | null;
  selected_network: string;
  request_id: string;
  internal_campaign_id: number | null;
  impression_confirmed: number | boolean;
  final_result: string | null;
  status: string;
  is_deleted: number | boolean;
  created_at: Date | string;
  publisher_id: number;
};

export function OPTIONS() {
  return new Response(null, { status: 204 });
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function cleanOptionalText(value: unknown) {
  const text = cleanText(value);
  return text || null;
}

function publicInternalImpressionError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Unauthorized") || message.startsWith("Invalid initData")) {
    return { message, status: 401 };
  }
  return { message: "Failed to confirm internal ad impression", status: 400 };
}

async function createInternalRewardEvent(
  conn: Awaited<ReturnType<typeof pool.getConnection>>,
  input: { requestId: string; miniappId: number; publisherId: number; telegramUserId: string }
) {
  const binding = await getActiveProductionBindingForMiniapp(conn, input.miniappId);
  const event = await createRewardEvent({
    db: conn,
    requestId: input.requestId,
    miniappId: input.miniappId,
    applicationId: binding ? Number(binding.application_id) : null,
    publisherId: input.publisherId,
    telegramUserId: input.telegramUserId,
    provider: INTERNAL_NETWORK_NAME,
    status: "eligible",
    verificationLevel: "ads_galaxy_validated",
    rewardEligible: true,
    environment: "production",
    metadata: { completion_source: "internal_server_validated" },
  });
  if (binding && productionRewardCallbacksEnabled()) {
    await enqueueProductionRewardWebhook({
      db: conn,
      applicationId: Number(binding.application_id),
      eventType: "reward.eligible",
      event,
    });
  }
  await enqueueDirectMiniappRewardCallback({
    db: conn,
    miniappId: input.miniappId,
    verifiedTelegramUserId: input.telegramUserId,
    event,
  });
  return event;
}

export async function POST(request: Request) {
  const conn = await pool.getConnection();
  let miniappIdForLock = 0;
  let telegramUserIdForLock = "";

  try {
    const body = await request.json();
    const requestId = cleanText(body.request_id);
    const miniappId = Number(body.miniapp_id);
    const telegramUserId = cleanText(body.telegram_user_id);
    miniappIdForLock = miniappId;
    telegramUserIdForLock = telegramUserId;
    const eventType = isCompletionEvent(body.event_type) ? body.event_type : "impression_recorded";
    const completed = Boolean(body.completed) || eventType === "completed";
    const watchDurationSeconds = normalizeWatchDuration(body.watch_duration_seconds ?? (completed ? 15 : 1.5));
    const abandonmentReason = cleanOptionalText(body.abandonment_reason);

    if (!requestId) {
      return NextResponse.json({ error: "request_id is required" }, { status: 400 });
    }

    if (!Number.isInteger(miniappId) || miniappId <= 0) {
      return NextResponse.json({ error: "Valid miniapp_id is required" }, { status: 400 });
    }

    if (!telegramUserId) {
      return NextResponse.json({ error: "telegram_user_id is required" }, { status: 400 });
    }

    const trackingUser = await requireMiniappTrackingUser(request, miniappId, telegramUserId);
    if (trackingUser.telegramUserId !== telegramUserId) {
      return NextResponse.json({ error: "telegram_user_id does not match authenticated user" }, { status: 403 });
    }

    await conn.beginTransaction();

    const [rows] = await conn.query<RequestRow[]>(`
      SELECT
        mr.id,
        mr.miniapp_id,
        mr.telegram_user_id,
        mr.country,
        mr.selected_network,
        mr.request_id,
        mr.internal_campaign_id,
        mr.impression_confirmed,
        mr.final_result,
        mr.created_at,
        m.status,
        m.user_id AS publisher_id,
        m.is_deleted
      FROM miniapp_mediation_requests mr
      JOIN miniapps m ON mr.miniapp_id = m.id
      WHERE mr.request_id = ?
      FOR UPDATE
    `, [requestId]);

    if (rows.length === 0) {
      await conn.rollback();
      return NextResponse.json({ error: "Mediation request not found" }, { status: 404 });
    }

    const mediationRequest = rows[0];

    if (Number(mediationRequest.miniapp_id) !== miniappId) {
      await conn.rollback();
      return NextResponse.json({ error: "request_id does not belong to this miniapp_id" }, { status: 400 });
    }

    if (String(mediationRequest.telegram_user_id) !== telegramUserId) {
      await conn.rollback();
      return NextResponse.json({ error: "telegram_user_id does not match mediation request" }, { status: 403 });
    }

    if (mediationRequest.selected_network !== INTERNAL_NETWORK_NAME || !mediationRequest.internal_campaign_id) {
      await conn.rollback();
      return NextResponse.json({ error: "Mediation request is not an internal ad request" }, { status: 400 });
    }

    if (mediationRequest.status !== "approved" && mediationRequest.status !== "monetized") {
      await conn.rollback();
      return NextResponse.json({ error: "Mini App is not approved for internal ads" }, { status: 403 });
    }

    if (Boolean(mediationRequest.is_deleted)) {
      await conn.rollback();
      return NextResponse.json({ error: "Mini App not found" }, { status: 404 });
    }

    if (mediationRequest.final_result === "insufficient_balance") {
      await conn.commit();
      return NextResponse.json({
        success: false,
        duplicate: true,
        idempotent: true,
        error: "Advertiser balance is insufficient for the next impression",
        error_code: "INSUFFICIENT_BALANCE",
        request_id: requestId,
      }, { status: 402 });
    }
    if (mediationRequest.final_result === "campaign_budget_exhausted") {
      await conn.commit();
      return NextResponse.json({
        success: false,
        duplicate: true,
        idempotent: true,
        error: "Campaign budget cannot fund the next impression",
        error_code: "CAMPAIGN_BUDGET_EXHAUSTED",
        request_id: requestId,
      }, { status: 402 });
    }

    const elapsedSeconds = (Date.now() - new Date(mediationRequest.created_at).getTime()) / 1000;
    if (completed && elapsedSeconds < 14) {
      await conn.rollback();
      return NextResponse.json({ error: "Ad completion was reported too early" }, { status: 409 });
    }

    if (Boolean(mediationRequest.impression_confirmed)) {
      const quality = await recordInternalAdCompletionEvent({
        conn,
        requestId,
        miniappId,
        campaignId: Number(mediationRequest.internal_campaign_id),
        telegramUserId,
        eventType,
        watchDurationSeconds,
        completed,
        abandonmentReason,
        metadata: {
          event_source: "miniapp_sdk",
          device_id: cleanOptionalText(body.device_id),
          session_id: cleanOptionalText(body.session_id),
        },
      });
      const rewardEvent = completed
        ? await createInternalRewardEvent(conn, { requestId, miniappId, publisherId: Number(mediationRequest.publisher_id), telegramUserId })
        : null;
      await conn.commit();
      return NextResponse.json({
        success: true,
        duplicate: true,
        idempotent: true,
        request_id: requestId,
        ...(rewardEvent ? { event_id: rewardEvent.event_id, completed: true, reward_eligible: true, status: "completed" } : {}),
        ...quality,
      });
    }

    const completionQualityTier = watchDurationQualityTier(watchDurationSeconds, completed);
    const trustedGeo = trustedMiniAppCountry(request.headers, mediationRequest.country);
    const economicIdentity = miniAppEconomicIdentity(request.headers, {
      telegramUserId,
      sessionId: body.session_id,
      deviceId: body.device_id,
      fingerprint: body.fingerprint,
    });
    const result = await recordInternalAdImpression({
      conn,
      campaignId: Number(mediationRequest.internal_campaign_id),
      miniappId,
      requestId,
      telegramUserId,
      country: trustedGeo.country,
      countrySource: trustedGeo.source,
      sessionHash: economicIdentity.session_hash,
      deviceHash: economicIdentity.device_hash,
      networkHash: economicIdentity.network_hash,
      watchDurationSeconds,
      completionQualityTier,
      completionQualityScore: qualityScoreForWatchTier(completionQualityTier),
      completionStatus: completed ? "completed" : "impression_recorded",
    });

    if ("cooldown" in result && result.cooldown) {
      await conn.rollback();
      return NextResponse.json({
        success: false,
        error: "Please wait before viewing another internal ad in this Mini App.",
        error_code: "INTERNAL_USER_COOLDOWN",
        request_id: requestId,
      }, { status: 409 });
    }

    if (result.insufficient_balance) {
      await conn.query(
        "UPDATE miniapp_mediation_requests SET final_result = 'insufficient_balance' WHERE id = ?",
        [mediationRequest.id]
      );
      await conn.commit();
      return NextResponse.json({
        success: false,
        error: "Advertiser balance is insufficient for the next impression",
        error_code: "INSUFFICIENT_BALANCE",
        request_id: requestId,
      }, { status: 402 });
    }

    if ("budget_exhausted" in result && result.budget_exhausted && !("publisher_revenue" in result)) {
      await conn.query(
        "UPDATE miniapp_mediation_requests SET final_result = 'campaign_budget_exhausted' WHERE id = ?",
        [mediationRequest.id]
      );
      await conn.commit();
      void dispatchMiniAppCampaignNotifications(5).catch(() => undefined);
      return NextResponse.json({
        success: false,
        error: "Campaign budget cannot fund the next impression",
        error_code: "CAMPAIGN_BUDGET_EXHAUSTED",
        request_id: requestId,
      }, { status: 402 });
    }

    await conn.query(
      "UPDATE miniapp_mediation_requests SET impression_confirmed = 1, impression_confirmed_at = NOW(), final_result = 'impression_confirmed' WHERE id = ?",
      [mediationRequest.id]
    );
    await recordNetworkSuccess(conn, miniappId, INTERNAL_NETWORK_NAME);
    console.info("[AdsGalaxy MiniApp mediation]", {
      event: "final_displayed_provider",
      miniapp_id: miniappId,
      request_id: requestId,
      final_displayed_provider: INTERNAL_NETWORK_NAME,
      internal_campaign_id: Number(mediationRequest.internal_campaign_id),
    });
    const quality = await recordInternalAdCompletionEvent({
      conn,
      requestId,
      miniappId,
      campaignId: Number(mediationRequest.internal_campaign_id),
      telegramUserId,
      eventType,
      watchDurationSeconds,
      completed,
      abandonmentReason,
      metadata: {
        event_source: "miniapp_sdk",
        device_id: cleanOptionalText(body.device_id),
        session_id: cleanOptionalText(body.session_id),
      },
    });
    const rewardEvent = completed
      ? await createInternalRewardEvent(conn, { requestId, miniappId, publisherId: Number(mediationRequest.publisher_id), telegramUserId })
      : null;

    await conn.commit();
    if ("budget_exhausted" in result && result.budget_exhausted) {
      void dispatchMiniAppCampaignNotifications(5).catch(() => undefined);
    }

    return NextResponse.json({
      success: true,
      request_id: requestId,
      ...(rewardEvent ? { event_id: rewardEvent.event_id, completed: true, reward_eligible: true, status: "completed" } : {}),
      miniapp_id: miniappId,
      network_name: INTERNAL_NETWORK_NAME,
      ...quality,
      ...result,
    });
  } catch (error: any) {
    try {
      await conn.rollback();
    } catch {
      // Transaction may not have started.
    }

    console.error("Internal Mini App impression failed", {
      error_name: error instanceof Error ? error.name : "UnknownError",
      error_code: typeof error?.code === "string" ? error.code : undefined,
    });
    const publicError = publicInternalImpressionError(error);
    return NextResponse.json({ error: publicError.message }, { status: publicError.status });
  } finally {
    // The impression helper holds this connection-scoped lock through the transaction commit/rollback.
    // Bound cleanup time so a stalled RELEASE_LOCK cannot permanently consume a pool slot.
    let reusable = true;
    try {
      await Promise.race([
        conn.query("SELECT RELEASE_LOCK(?)", [internalAdCooldownLockName(
          miniappIdForLock,
          telegramUserIdForLock
        )]),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error("Timed out releasing internal ad cooldown lock")),
          2_000
        )),
      ]);
    } catch {
      // Closing the connection releases its named locks and prevents pool starvation.
      reusable = false;
      conn.destroy();
    }
    if (reusable) conn.release();
  }
}
