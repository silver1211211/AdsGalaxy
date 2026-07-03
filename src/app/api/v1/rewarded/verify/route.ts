import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { enqueueDeveloperWebhook, logDeveloperApiRequest, recordSandboxEvent, validateDeveloperApiRequest } from "@/lib/developerPlatform";

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
  const conn = await pool.getConnection();
  try {
    context = await validateDeveloperApiRequest(request, "reward_validation", "/api/v1/rewarded/verify");
    if (context.mode === "production") throw Object.assign(new Error("Production reward verification is not enabled; use the Mini App SDK"), { statusCode: 501 });
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
    try {
      await conn.rollback();
    } catch {}
    const status = Number(error.statusCode || 400);
    await logDeveloperApiRequest(context, request, status, false, undefined, error.message);
    return NextResponse.json({ error: error.message || "Reward verification failed" }, { status });
  } finally {
    conn.release();
  }
}
