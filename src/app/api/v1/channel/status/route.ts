import { NextResponse } from "next/server";
import { logDeveloperApiRequest, validateDeveloperApiRequest } from "@/lib/developerPlatform";
import { publicApiErrorMessage } from "@/lib/publicApiErrors";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function POST(request: Request) {
  let context: any = null;
  try {
    context = await validateDeveloperApiRequest(request, "read_only", "/api/v1/channel/status");
    const body = await request.json().catch(() => ({}));
    const payload = {
      post_id: clean(body.post_id),
      campaign_id: clean(body.campaign_id) || "sandbox_channel_campaign",
      status: context.mode === "production" ? "queued" : "sandbox_delivered",
      delivered_at: new Date().toISOString(),
      sandbox: context.mode !== "production",
    };
    await logDeveloperApiRequest(context, request, 200, true, payload);
    return NextResponse.json({ success: true, api_version: "v1", ...payload });
  } catch (error: any) {
    const status = Number(error.statusCode || 400);
    await logDeveloperApiRequest(context, request, status, false, undefined, error.message);
    return NextResponse.json({ error: publicApiErrorMessage(error, "Channel status lookup failed", status) }, { status });
  }
}
