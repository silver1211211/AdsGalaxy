import { NextResponse } from "next/server";
import { enqueueDeveloperWebhook, logDeveloperApiRequest, recordSandboxEvent, validateDeveloperApiRequest } from "@/lib/developerPlatform";
import { publicApiErrorMessage } from "@/lib/publicApiErrors";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function POST(request: Request) {
  let context: any = null;
  try {
    context = await validateDeveloperApiRequest(request, "reporting", "/api/v1/channel/reports");
    const body = await request.json().catch(() => ({}));
    const payload = {
      channel_id: clean(body.channel_id),
      campaign_id: clean(body.campaign_id),
      report_type: clean(body.report_type) || "delivery",
      post_url: clean(body.post_url),
      impressions: Number(body.impressions || 0),
      clicks: Number(body.clicks || 0),
      request_id: clean(body.request_id) || `channel_${Date.now()}`,
      metadata: body.metadata || {},
    };
    await recordSandboxEvent(context.applicationId, "channel_report", payload);
    await enqueueDeveloperWebhook(context.applicationId, "channel.reported", payload);
    await logDeveloperApiRequest(context, request, 200, true, payload);
    return NextResponse.json({ success: true, accepted: true, api_version: "v1", sandbox: context.mode !== "production" });
  } catch (error: any) {
    const status = Number(error.statusCode || 400);
    await logDeveloperApiRequest(context, request, status, false, undefined, error.message);
    return NextResponse.json({ error: publicApiErrorMessage(error, "Channel report failed", status) }, { status });
  }
}
