import { NextResponse } from "next/server";
import { deleteCampaignPosts, markStalePendingDeliveryPosts } from "@/lib/campaignPostDeletion";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const lock = await acquireCronLock("cleanup-posts", 1800);
  if (!lock) {
    return NextResponse.json({ success: false, message: "Cleanup posts cron is already running" }, { status: 409 });
  }

  try {
    const pendingRecovery = await markStalePendingDeliveryPosts(
      Number.parseInt(process.env.PENDING_DELIVERY_TIMEOUT_MINUTES || "10", 10)
    );
    const summary = await deleteCampaignPosts({
      olderThan24Hours: true,
      batchSize: 30,
      batchDelayMs: 500,
    });

    return NextResponse.json({
      success: true,
      processed: summary.total,
      deleted: summary.deleted,
      failed: summary.failed,
      failedIds: summary.failedIds,
      pendingRecovery,
      details: summary.details,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Cron Cleanup Posts Error:", error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
