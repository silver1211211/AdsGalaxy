import { NextResponse } from "next/server";
import { enqueueDeveloperWebhook, logDeveloperApiRequest, recordSandboxEvent, validateDeveloperApiRequest } from "@/lib/developerPlatform";
import pool from "@/lib/db";
import { publicApiErrorMessage } from "@/lib/publicApiErrors";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function POST(request: Request) {
  let context: any = null;
  try {
    context = await validateDeveloperApiRequest(request, "reward_validation", "/api/v1/rewarded/callback");
    if (context.mode === "production") throw Object.assign(new Error("Production reward callbacks are not enabled; use the Mini App SDK"), { statusCode: 501 });
    const body = await request.json().catch(() => ({}));
    const callbackId = clean(body.callback_id);
    const requestId = clean(body.request_id);
    const externalUserId = clean(body.external_user_id);
    if (!callbackId || !requestId || !externalUserId) throw Object.assign(new Error("callback_id, request_id and external_user_id are required"), { statusCode: 400 });
    const [verifiedRows]: any = await pool.query(
      "SELECT id FROM developer_reward_verifications WHERE application_id = ? AND request_id = ? AND external_user_id = ? AND eligible = 1 LIMIT 1",
      [context.applicationId, requestId, externalUserId]
    );
    if (!verifiedRows[0]) throw Object.assign(new Error("Reward has not been verified"), { statusCode: 409 });
    const [duplicateRows]: any = await pool.query(
      "SELECT id FROM developer_sandbox_events WHERE application_id = ? AND event_type = 'reward_callback' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.callback_id')) = ? LIMIT 1",
      [context.applicationId, callbackId]
    );
    if (duplicateRows[0]) return NextResponse.json({ success: true, accepted: true, idempotent: true, api_version: "v1", sandbox: true });
    const payload = {
      callback_id: callbackId,
      request_id: requestId,
      external_user_id: externalUserId,
      reward_status: clean(body.reward_status) || "credited",
      metadata: body.metadata || {},
    };
    await recordSandboxEvent(context.applicationId, "reward_callback", payload);
    await enqueueDeveloperWebhook(context.applicationId, "reward.credited", payload);
    await logDeveloperApiRequest(context, request, 200, true, payload);
    return NextResponse.json({ success: true, accepted: true, api_version: "v1", sandbox: context.mode !== "production" });
  } catch (error: any) {
    const status = Number(error.statusCode || 400);
    await logDeveloperApiRequest(context, request, status, false, undefined, error.message);
    return NextResponse.json({ error: publicApiErrorMessage(error, "Reward callback failed", status) }, { status });
  }
}
