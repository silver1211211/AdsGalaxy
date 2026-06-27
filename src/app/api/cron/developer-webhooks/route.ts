import { NextResponse } from "next/server";
import { processPendingWebhookDeliveries } from "@/lib/developerPlatform";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const lock = await acquireCronLock("developer-webhooks", 900);
  if (!lock) {
    return NextResponse.json({ success: false, message: "Developer webhooks cron is already running" }, { status: 409 });
  }

  try {
    const result = await processPendingWebhookDeliveries();
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Webhook retry processing failed" }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
