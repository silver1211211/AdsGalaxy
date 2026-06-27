import { NextResponse } from "next/server";
import { enqueueDeveloperWebhook, logDeveloperApiRequest, recordSandboxEvent, validateDeveloperApiRequest } from "@/lib/developerPlatform";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function POST(request: Request) {
  let context: any = null;
  try {
    context = await validateDeveloperApiRequest(request, "read_only", "/api/v1/bot/campaigns");
    const body = await request.json().catch(() => ({}));
    const requestId = clean(body.request_id) || `bot_campaign_${context.applicationId}_${Date.now()}`;
    const campaign = {
      id: clean(body.campaign_id) || "sandbox_bot_campaign",
      title: "AdsGalaxy Bot SDK Sandbox Campaign",
      message: "This sandbox campaign validates bot integration without production delivery.",
      cta_text: "Open",
      tracking_token: requestId,
      sandbox: context.mode !== "production",
    };
    await recordSandboxEvent(context.applicationId, "bot_campaign_loaded", { ...body, request_id: requestId, campaign });
    await enqueueDeveloperWebhook(context.applicationId, "bot.campaign.loaded", { request_id: requestId, campaign });
    await logDeveloperApiRequest(context, request, 200, true, { request_id: requestId, campaign_id: campaign.id });
    return NextResponse.json({ success: true, api_version: "v1", campaign });
  } catch (error: any) {
    const status = Number(error.statusCode || 400);
    await logDeveloperApiRequest(context, request, status, false, undefined, error.message);
    return NextResponse.json({ error: error.message || "Bot campaign load failed" }, { status });
  }
}
