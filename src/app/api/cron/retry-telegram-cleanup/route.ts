import { NextResponse } from "next/server";
import { retryCampaignPostCleanup } from "@/lib/campaignPostDeletion";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const lock = await acquireCronLock("retry-telegram-cleanup", 1200);
  if (!lock) {
    return NextResponse.json({ success: false, message: "Telegram cleanup retry is already running" }, { status: 409 });
  }

  try {
    const result = await retryCampaignPostCleanup();
    return NextResponse.json({
      success: true,
      checked: result.checked,
      deleted: result.deleted,
      failed: result.failed,
      retry: result.retry,
      skipped: result.skipped,
      failed_ids: result.failedIds,
      details: result.details,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "retry_telegram_cleanup_failed";
    console.error("Retry Telegram cleanup cron failed", { error: message });
    return NextResponse.json({ success: false, message }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
