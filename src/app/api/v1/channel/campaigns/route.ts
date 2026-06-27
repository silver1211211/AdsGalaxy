import { NextResponse } from "next/server";
import { enqueueDeveloperWebhook, logDeveloperApiRequest, recordSandboxEvent, validateDeveloperApiRequest } from "@/lib/developerPlatform";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function POST(request: Request) {
  let context: any = null;
  try {
    context = await validateDeveloperApiRequest(request, "conversion_tracking", "/api/v1/channel/campaigns");
    const body = await request.json().catch(() => ({}));
    const postId = clean(body.post_id) || `sandbox_post_${context.applicationId}_${Date.now()}`;
    const payload = {
      post_id: postId,
      channel_id: clean(body.channel_id),
      campaign_id: clean(body.campaign_id) || "sandbox_channel_campaign",
      status: context.mode === "production" ? "queued" : "sandbox_accepted",
      post_url: clean(body.post_url),
      scheduled_at: clean(body.scheduled_at) || null,
      metadata: body.metadata || {},
    };
    await recordSandboxEvent(context.applicationId, "channel_campaign_posted", payload);
    await enqueueDeveloperWebhook(context.applicationId, "channel.campaign.posted", payload);
    await logDeveloperApiRequest(context, request, 200, true, payload);
    return NextResponse.json({ success: true, api_version: "v1", sandbox: context.mode !== "production", ...payload });
  } catch (error: any) {
    const status = Number(error.statusCode || 400);
    await logDeveloperApiRequest(context, request, status, false, undefined, error.message);
    return NextResponse.json({ error: error.message || "Channel campaign post failed" }, { status });
  }
}
