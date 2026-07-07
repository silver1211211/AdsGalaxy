import { NextResponse } from "next/server";
import { enqueueDeveloperWebhook, logDeveloperApiRequest, recordSandboxEvent, validateDeveloperApiRequest } from "@/lib/developerPlatform";
import pool from "@/lib/db";
import { publicApiErrorMessage } from "@/lib/publicApiErrors";

export const dynamic = "force-dynamic";

const VALID_EVENTS = new Set(["impression", "click", "completion", "reward", "interaction"]);

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function POST(request: Request) {
  let context: any = null;
  try {
    context = await validateDeveloperApiRequest(request, "reporting", "/api/v1/ads/events");
    if (context.mode === "production") throw Object.assign(new Error("Production Ads API events are not enabled; use the Mini App SDK"), { statusCode: 501 });
    const body = await request.json().catch(() => ({}));
    const eventType = clean(body.event_type);
    if (!VALID_EVENTS.has(eventType)) {
      return NextResponse.json({ error: "Invalid event_type" }, { status: 400 });
    }
    const requestId = clean(body.request_id);
    const externalUserId = clean(body.external_user_id);
    if (!requestId) return NextResponse.json({ error: "request_id is required" }, { status: 400 });
    const [issuedRows]: any = await pool.query(
      `SELECT external_user_id FROM developer_sandbox_events
       WHERE application_id = ? AND request_id = ? AND event_type IN ('ad_requested', 'rewarded_requested')
       ORDER BY id ASC LIMIT 1`,
      [context.applicationId, requestId]
    );
    if (!issuedRows[0]) return NextResponse.json({ error: "request_id was not issued by AdsGalaxy" }, { status: 404 });
    if (clean(issuedRows[0].external_user_id) && clean(issuedRows[0].external_user_id) !== externalUserId) {
      return NextResponse.json({ error: "request_id does not belong to this user" }, { status: 403 });
    }
    const [duplicateRows]: any = await pool.query(
      "SELECT id FROM developer_sandbox_events WHERE application_id = ? AND request_id = ? AND event_type = ? LIMIT 1",
      [context.applicationId, requestId, `ad_${eventType}`]
    );
    if (duplicateRows[0]) return NextResponse.json({ success: true, accepted: true, idempotent: true, api_version: "v1", sandbox: true });
    const payload = {
      request_id: requestId,
      event_type: eventType,
      external_user_id: externalUserId,
      value: body.value ?? null,
      metadata: body.metadata || {},
    };
    await recordSandboxEvent(context.applicationId, `ad_${eventType}`, payload);
    await enqueueDeveloperWebhook(context.applicationId, `ad.${eventType}`, payload);
    await logDeveloperApiRequest(context, request, 200, true, payload);
    return NextResponse.json({ success: true, accepted: true, api_version: "v1", sandbox: context.mode !== "production" });
  } catch (error: any) {
    const status = Number(error.statusCode || 400);
    await logDeveloperApiRequest(context, request, status, false, undefined, error.message);
    return NextResponse.json({ error: publicApiErrorMessage(error, "Ad event failed", status) }, { status });
  }
}
