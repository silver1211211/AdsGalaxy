import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { enqueueDeveloperWebhook, logDeveloperApiRequest, recordSandboxEvent, validateDeveloperApiRequest } from "@/lib/developerPlatform";
import {
  bindExternalUserReference,
  getRewardEventByEventId,
  getRewardEventByRequestId,
  isScopedMediationRequestPending,
  normalizeRewardEvent,
  productionRewardCallbacksEnabled,
  requireApplicationMiniappScope,
  RewardCallbackError,
  type RewardEventRow,
} from "@/lib/miniappRewardEvents";
import { publicApiErrorMessage } from "@/lib/publicApiErrors";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value || "").trim();
}

type IssuedRewardRequestRow = RowDataPacket & {
  application_id: number;
  external_user_id: string | null;
  request_id: string;
};

type VerificationRow = RowDataPacket & {
  application_id: number;
  request_id: string;
  reward_id: string | null;
  external_user_id: string;
  eligible: number | boolean;
  status: string;
  payload: string | null;
};

export async function POST(request: Request) {
  let context: any = null;
  let conn: Awaited<ReturnType<typeof pool.getConnection>> | null = null;
  try {
    context = await validateDeveloperApiRequest(request, "reward_validation", "/api/v1/rewarded/verify");
    if (context.mode === "production") {
      if (!productionRewardCallbacksEnabled()) {
        throw Object.assign(new Error("Production reward verification is not enabled; use the Mini App SDK"), { statusCode: 501 });
      }
      if (context.keyType !== "private") {
        throw new RewardCallbackError(403, "INVALID_API_KEY_TYPE", "private API key required");
      }
      const body = await request.json().catch(() => ({}));
      const miniappId = Number(body.mini_app_id);
      const requestId = clean(body.request_id);
      const eventId = clean(body.event_id);
      const externalUserReference = clean(body.external_user_reference);
      if (!Number.isInteger(miniappId) || miniappId <= 0 || (!requestId && !eventId)) {
        throw new RewardCallbackError(400, "INVALID_VERIFY_REQUEST", "mini_app_id and request_id or event_id are required");
      }
      if (requestId.length > 64 || eventId.length > 64 || (eventId && !eventId.startsWith("rwe_"))) {
        throw new RewardCallbackError(400, "INVALID_VERIFY_REQUEST", "Invalid reward identifier");
      }

      await requireApplicationMiniappScope({
        applicationId: context.applicationId,
        miniappId,
        environment: "production",
        userId: context.userId,
      });

      const byRequest = requestId ? await getRewardEventByRequestId(requestId) : null;
      const byEvent = eventId ? await getRewardEventByEventId(eventId) : null;
      if (requestId && eventId && (!byRequest || !byEvent || byRequest.id !== byEvent.id)) {
        throw new RewardCallbackError(409, "REWARD_IDENTIFIER_CONFLICT", "Reward identifiers do not match");
      }
      let event: RewardEventRow | null = byRequest || byEvent;
      if (
        event
        && (
          Number(event.application_id) !== context.applicationId
          || Number(event.miniapp_id) !== miniappId
          || event.environment !== "production"
        )
      ) {
        event = null;
      }
      if (!event) {
        const pending = requestId && await isScopedMediationRequestPending({
          requestId,
          miniappId,
          publisherId: context.userId,
        });
        if (pending) {
          await logDeveloperApiRequest(context, request, 202, false, { request_id: requestId, error_code: "EVENT_PENDING" });
          return NextResponse.json({
            success: false,
            error_code: "EVENT_PENDING",
            error: "Reward event is still being prepared",
          }, { status: 202 });
        }
        throw new RewardCallbackError(404, "REWARD_EVENT_NOT_FOUND", "Reward event is unavailable");
      }
      if (externalUserReference) {
        event = await bindExternalUserReference({
          eventId: event.event_id,
          applicationId: context.applicationId,
          miniappId,
          environment: "production",
          externalUserReference,
        });
      }
      const response = {
        success: true,
        api_version: "v1",
        environment: "production",
        event: normalizeRewardEvent(event),
      };
      await logDeveloperApiRequest(context, request, 200, true, { request_id: event.request_id, event_id: event.event_id });
      return NextResponse.json(response);
    }
    conn = await pool.getConnection();
    const body = await request.json().catch(() => ({}));
    const requestId = clean(body.request_id);
    const externalUserId = clean(body.external_user_id);
    const rewardId = clean(body.reward_id);
    const completed = Boolean(body.completed ?? true);

    if (!requestId || !externalUserId) {
      throw Object.assign(new Error("request_id and external_user_id are required"), { statusCode: 400 });
    }

    await conn.beginTransaction();

    const [existingRows] = await conn.query<VerificationRow[]>(
      "SELECT application_id, request_id, reward_id, external_user_id, eligible, status, payload FROM developer_reward_verifications WHERE request_id = ? FOR UPDATE",
      [requestId]
    );
    if (existingRows.length > 0) {
      const existing = existingRows[0];
      if (Number(context.applicationId) !== Number(existing.application_id) || existing.external_user_id !== externalUserId) {
        await conn.rollback();
        throw Object.assign(new Error("request_id has already been verified for a different application or user"), { statusCode: 409 });
      }
      await conn.commit();
      const existingPayload = existing.payload ? JSON.parse(existing.payload) : {};
      await logDeveloperApiRequest(context, request, 200, true, { request_id: requestId, idempotent: true });
      return NextResponse.json({ success: true, api_version: "v1", idempotent: true, ...existingPayload });
    }

    const [issuedRows] = await conn.query<IssuedRewardRequestRow[]>(
      `SELECT application_id, external_user_id, request_id
       FROM developer_sandbox_events
       WHERE request_id = ?
         AND event_type = 'rewarded_requested'
       ORDER BY id ASC
       LIMIT 1
       FOR UPDATE`,
      [requestId]
    );
    const issued = issuedRows[0];
    if (!issued) {
      await conn.rollback();
      throw Object.assign(new Error("request_id was not issued by AdsGalaxy"), { statusCode: 404 });
    }
    if (Number(issued.application_id) !== Number(context.applicationId)) {
      await conn.rollback();
      throw Object.assign(new Error("request_id does not belong to this application"), { statusCode: 403 });
    }
    if (clean(issued.external_user_id) !== externalUserId) {
      await conn.rollback();
      throw Object.assign(new Error("request_id does not belong to this user"), { statusCode: 403 });
    }
    const [completionRows] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM developer_sandbox_events
       WHERE application_id = ? AND request_id = ? AND event_type = 'ad_completion' AND external_user_id = ?
       LIMIT 1 FOR UPDATE`,
      [context.applicationId, requestId, externalUserId]
    );
    if (!completionRows[0] || !completed) {
      await conn.rollback();
      throw Object.assign(new Error("A completed ad event is required before reward verification"), { statusCode: 409 });
    }

    const payload = {
      request_id: requestId,
      reward_id: rewardId,
      external_user_id: externalUserId,
      eligible: completed,
      completed,
      sandbox: context.mode !== "production",
      application_id: context.applicationId,
      status: completed ? "verified" : "not_completed",
    };

    await conn.query(
      `INSERT INTO developer_reward_verifications
        (application_id, request_id, external_user_id, reward_id, eligible, status, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [context.applicationId, requestId, externalUserId, rewardId || null, payload.eligible ? 1 : 0, payload.status, JSON.stringify(payload)]
    );

    await conn.commit();
    await recordSandboxEvent(context.applicationId, "reward_verified", payload);
    await enqueueDeveloperWebhook(context.applicationId, "reward.verified", payload);
    await logDeveloperApiRequest(context, request, 200, true, payload);
    return NextResponse.json({ success: true, api_version: "v1", ...payload });
  } catch (error: any) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {}
    }
    const status = Number(error.statusCode || 400);
    await logDeveloperApiRequest(context, request, status, false, undefined, error.message);
    const errorCode = error instanceof RewardCallbackError ? error.code : undefined;
    return NextResponse.json({
      error: publicApiErrorMessage(error, "Reward verification failed", status),
      ...(context?.mode === "production" && errorCode ? { error_code: errorCode } : {}),
    }, { status });
  } finally {
    conn?.release();
  }
}
