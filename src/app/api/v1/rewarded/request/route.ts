import { NextResponse } from "next/server";
import { enqueueDeveloperWebhook, logDeveloperApiRequest, recordSandboxEvent, sandboxAdPayload, validateDeveloperApiRequest } from "@/lib/developerPlatform";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function POST(request: Request) {
  let context: any = null;
  try {
    context = await validateDeveloperApiRequest(request, "reward_validation", "/api/v1/rewarded/request");
    const body = await request.json().catch(() => ({}));
    const ad = sandboxAdPayload(context.applicationId, "rewarded");
    const payload = {
      ...ad,
      external_user_id: clean(body.external_user_id),
      reward_id: `reward_${ad.request_id}`,
      reward_name: clean(body.reward_name) || "Sandbox Reward",
    };
    await recordSandboxEvent(context.applicationId, "rewarded_requested", payload);
    await enqueueDeveloperWebhook(context.applicationId, "reward.requested", payload);
    await logDeveloperApiRequest(context, request, 200, true, { request_id: ad.request_id });
    return NextResponse.json({ success: true, api_version: "v1", mode: context.mode, ...payload });
  } catch (error: any) {
    const status = Number(error.statusCode || 400);
    await logDeveloperApiRequest(context, request, status, false, undefined, error.message);
    return NextResponse.json({ error: error.message || "Rewarded ad request failed" }, { status });
  }
}
