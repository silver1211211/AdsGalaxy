import { NextResponse } from "next/server";
import { enqueueDeveloperWebhook, logDeveloperApiRequest, recordSandboxEvent, validateDeveloperApiRequest } from "@/lib/developerPlatform";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function POST(request: Request) {
  let context: any = null;
  try {
    context = await validateDeveloperApiRequest(request, "reporting", "/api/v1/bot/events");
    const body = await request.json().catch(() => ({}));
    const eventType = clean(body.event_type) || "interaction";
    const payload = {
      bot_id: clean(body.bot_id),
      campaign_id: clean(body.campaign_id),
      event_type: eventType,
      external_user_id: clean(body.external_user_id),
      request_id: clean(body.request_id) || `bot_${Date.now()}`,
      metadata: body.metadata || {},
    };
    await recordSandboxEvent(context.applicationId, `bot_${eventType}`, payload);
    await enqueueDeveloperWebhook(context.applicationId, `bot.${eventType}`, payload);
    await logDeveloperApiRequest(context, request, 200, true, payload);
    return NextResponse.json({
      success: true,
      api_version: "v1",
      sandbox: context.mode !== "production",
      campaign: {
        id: payload.campaign_id || "sandbox_campaign",
        title: "AdsGalaxy Bot SDK Sandbox Campaign",
        tracking_token: payload.request_id,
      },
    });
  } catch (error: any) {
    const status = Number(error.statusCode || 400);
    await logDeveloperApiRequest(context, request, status, false, undefined, error.message);
    return NextResponse.json({ error: error.message || "Bot SDK event failed" }, { status });
  }
}
