import { NextResponse } from "next/server";
import { logDeveloperApiRequest, validateDeveloperApiRequest } from "@/lib/developerPlatform";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function POST(request: Request) {
  let context: any = null;
  try {
    context = await validateDeveloperApiRequest(request, "reporting", "/api/v1/channel/analytics");
    const body = await request.json().catch(() => ({}));
    const payload = {
      channel_id: clean(body.channel_id),
      campaign_id: clean(body.campaign_id) || "sandbox_channel_campaign",
      impressions: 128,
      clicks: 14,
      conversions: 3,
      ctr: 0.1094,
      sandbox: context.mode !== "production",
    };
    await logDeveloperApiRequest(context, request, 200, true, payload);
    return NextResponse.json({ success: true, api_version: "v1", analytics: payload });
  } catch (error: any) {
    const status = Number(error.statusCode || 400);
    await logDeveloperApiRequest(context, request, status, false, undefined, error.message);
    return NextResponse.json({ error: error.message || "Channel analytics failed" }, { status });
  }
}
