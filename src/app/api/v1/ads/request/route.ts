import { NextResponse } from "next/server";
import { enqueueDeveloperWebhook, logDeveloperApiRequest, recordSandboxEvent, sandboxAdPayload, validateDeveloperApiRequest } from "@/lib/developerPlatform";
import { requireAdServingAllowed } from "@/lib/productionSafety";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function POST(request: Request) {
  let context: any = null;
  try {
    const blocked = await requireAdServingAllowed();
    if (blocked) return blocked;

    context = await validateDeveloperApiRequest(request, "read_only", "/api/v1/ads/request");
    const body = await request.json().catch(() => ({}));
    const ad = sandboxAdPayload(context.applicationId, clean(body.ad_format) || "rewarded");
    await recordSandboxEvent(context.applicationId, "ad_requested", { ...body, ...ad });
    await enqueueDeveloperWebhook(context.applicationId, "ad.requested", ad);
    await logDeveloperApiRequest(context, request, 200, true, { request_id: ad.request_id, ad_format: ad.ad_format });
    return NextResponse.json({ success: true, api_version: "v1", mode: context.mode, ...ad });
  } catch (error: any) {
    const status = Number(error.statusCode || 400);
    await logDeveloperApiRequest(context, request, status, false, undefined, error.message);
    return NextResponse.json({ error: error.message || "Ad request failed" }, { status });
  }
}
