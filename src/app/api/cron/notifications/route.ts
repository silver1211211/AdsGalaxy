import { NextRequest, NextResponse } from "next/server";
import { dispatchPlatformNotifications } from "@/lib/platformNotifications";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (request.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ success: true, ...(await dispatchPlatformNotifications(100)) });
}
