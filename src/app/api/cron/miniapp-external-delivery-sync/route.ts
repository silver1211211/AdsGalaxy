import { NextResponse } from "next/server";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import { processMiniAppExternalDeliverySyncs } from "@/lib/miniappExternalDeliverySync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;
  const lock = await acquireCronLock("miniapp-external-delivery-sync", 110);
  if (!lock) return NextResponse.json({ success: false, message: "External delivery sync is already running" }, { status: 409 });
  try {
    return NextResponse.json({ success: true, ...(await processMiniAppExternalDeliverySyncs(100)) });
  } catch (error) {
    console.error("Mini App external delivery sync failed", error);
    return NextResponse.json({ error: "External delivery sync failed" }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
