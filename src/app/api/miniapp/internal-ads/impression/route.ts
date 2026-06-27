import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";
import { INTERNAL_NETWORK_NAME, recordInternalAdImpression } from "@/lib/miniappInternalAds";
import { recordNetworkSuccess } from "@/lib/miniappOptimization";
import { assertMiniAppOwnerBetaAccess, MiniAppBetaAccessError } from "@/lib/miniappBetaAccess";
import {
  isCompletionEvent,
  normalizeWatchDuration,
  recordInternalAdCompletionEvent,
  watchDurationQualityTier,
} from "@/lib/internalAdCompletionQuality";

type RequestRow = RowDataPacket & {
  id: number;
  miniapp_id: number;
  telegram_user_id: string | number;
  country: string | null;
  selected_network: string;
  request_id: string;
  internal_campaign_id: number | null;
  impression_confirmed: number | boolean;
  status: string;
  is_deleted: number | boolean;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function cleanOptionalText(value: unknown) {
  const text = cleanText(value);
  return text || null;
}

export async function POST(request: Request) {
  const conn = await pool.getConnection();

  try {
    const body = await request.json();
    const requestId = cleanText(body.request_id);
    const miniappId = Number(body.miniapp_id);
    const telegramUserId = cleanText(body.telegram_user_id);
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

    const initData = request.headers.get("x-telegram-init-data");
    if (!initData) {
      return NextResponse.json({ error: "Unauthorized: initData required" }, { status: 401 });
    }

    const authenticatedUser = await getAuthenticatedUser(initData);
    if (String(authenticatedUser.telegram_id) !== telegramUserId) {
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
        m.status,
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

    await assertMiniAppOwnerBetaAccess(miniappId, conn);

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
      await conn.commit();
      return NextResponse.json({
        success: true,
        duplicate: true,
        idempotent: true,
        request_id: requestId,
        ...quality,
      });
    }

    const completionQualityTier = watchDurationQualityTier(watchDurationSeconds, completed);
    const result = await recordInternalAdImpression({
      conn,
      campaignId: Number(mediationRequest.internal_campaign_id),
      miniappId,
      requestId,
      telegramUserId,
      country: mediationRequest.country,
      watchDurationSeconds,
      completionQualityTier,
      completionStatus: completed ? "completed" : "impression_recorded",
    });

    await conn.query(
      "UPDATE miniapp_mediation_requests SET impression_confirmed = 1, impression_confirmed_at = NOW(), final_result = 'impression_confirmed' WHERE id = ?",
      [mediationRequest.id]
    );
    await recordNetworkSuccess(conn, miniappId, INTERNAL_NETWORK_NAME);
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

    await conn.commit();

    return NextResponse.json({
      success: true,
      request_id: requestId,
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

    const message = error?.message || "Failed to confirm internal ad impression";
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
