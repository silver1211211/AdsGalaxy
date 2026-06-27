import { NextResponse } from "next/server";
import { enqueueDeveloperWebhook, logDeveloperApiRequest, recordSandboxEvent, validateDeveloperApiRequest } from "@/lib/developerPlatform";

export const dynamic = "force-dynamic";

const VALID_EVENTS = new Set(["impression", "click", "completion", "reward", "interaction"]);

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function POST(request: Request) {
  let context: any = null;
  try {
    context = await validateDeveloperApiRequest(request, "reporting", "/api/v1/ads/events");
    const body = await request.json().catch(() => ({}));
    const eventType = clean(body.event_type);
    if (!VALID_EVENTS.has(eventType)) {
      return NextResponse.json({ error: "Invalid event_type" }, { status: 400 });
    }
    const payload = {
      request_id: clean(body.request_id),
      event_type: eventType,
      external_user_id: clean(body.external_user_id),
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
    return NextResponse.json({ error: error.message || "Ad event failed" }, { status });
  }
}
