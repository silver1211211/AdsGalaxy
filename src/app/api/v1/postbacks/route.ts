import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { enqueueDeveloperWebhook, logDeveloperApiRequest, recordSandboxEvent, validateDeveloperApiRequest } from "@/lib/developerPlatform";
import { publicApiErrorMessage } from "@/lib/publicApiErrors";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function POST(request: Request) {
  let context: any = null;
  try {
    context = await validateDeveloperApiRequest(request, "conversion_tracking", "/api/v1/postbacks");
    const body = await request.json().catch(() => ({}));
    const eventType = clean(body.event_type) || "custom";
    const payload = {
      event_type: eventType,
      external_id: clean(body.external_id) || clean(body.click_id) || `postback_${Date.now()}`,
      value: body.value ?? null,
      currency: clean(body.currency) || "USD",
      metadata: body.metadata || {},
    };
    await pool.query(
      "INSERT INTO developer_postback_events (application_id, event_type, external_id, payload, status) VALUES (?, ?, ?, ?, 'accepted')",
      [context.applicationId, eventType, payload.external_id, JSON.stringify(payload)]
    );
    await recordSandboxEvent(context.applicationId, `postback_${eventType}`, payload);
    await enqueueDeveloperWebhook(context.applicationId, `postback.${eventType}`, payload);
    await logDeveloperApiRequest(context, request, 200, true, payload);
    return NextResponse.json({ success: true, accepted: true, api_version: "v1", sandbox: context.mode !== "production" });
  } catch (error: any) {
    const status = Number(error.statusCode || 400);
    await logDeveloperApiRequest(context, request, status, false, undefined, error.message);
    return NextResponse.json({ error: publicApiErrorMessage(error, "Postback failed", status) }, { status });
  }
}
