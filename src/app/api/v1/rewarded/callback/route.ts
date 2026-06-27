import { NextResponse } from "next/server";
import { enqueueDeveloperWebhook, logDeveloperApiRequest, recordSandboxEvent, validateDeveloperApiRequest } from "@/lib/developerPlatform";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function POST(request: Request) {
  let context: any = null;
  try {
    context = await validateDeveloperApiRequest(request, "reward_validation", "/api/v1/rewarded/callback");
    const body = await request.json().catch(() => ({}));
    const payload = {
      callback_id: clean(body.callback_id) || `reward_cb_${Date.now()}`,
      request_id: clean(body.request_id),
      external_user_id: clean(body.external_user_id),
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
    return NextResponse.json({ error: error.message || "Reward callback failed" }, { status });
  }
}
