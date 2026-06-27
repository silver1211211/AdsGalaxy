import { NextResponse } from "next/server";
import { recordConversion } from "@/lib/conversionTracking";

function paramsFromRequest(request: Request, body?: Record<string, unknown>) {
  const url = new URL(request.url);
  return {
    click_id: body?.click_id ?? url.searchParams.get("click_id"),
    event_type: body?.event_type ?? url.searchParams.get("event_type") ?? url.searchParams.get("type"),
    event_name: body?.event_name ?? url.searchParams.get("event_name") ?? url.searchParams.get("event"),
    value: body?.value ?? url.searchParams.get("value"),
    currency: body?.currency ?? url.searchParams.get("currency"),
  };
}

export async function GET(request: Request) {
  try {
    const params = paramsFromRequest(request);
    const result = await recordConversion({
      clickId: String(params.click_id || ""),
      eventType: params.event_type || "custom_event",
      eventName: params.event_name,
      value: params.value,
      currency: params.currency,
      source: "postback",
      payload: Object.fromEntries(new URL(request.url).searchParams.entries()),
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || "Postback failed" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const params = paramsFromRequest(request, body);
    const result = await recordConversion({
      clickId: String(params.click_id || ""),
      eventType: params.event_type || "custom_event",
      eventName: params.event_name,
      value: params.value,
      currency: params.currency,
      source: "postback",
      payload: body,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || "Postback failed" }, { status: 400 });
  }
}
