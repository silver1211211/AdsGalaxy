import { NextResponse } from "next/server";
import { deleteCampaignPosts, getConfiguredPostLifetimeHours, markStalePendingDeliveryPosts } from "@/lib/campaignPostDeletion";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";

export const dynamic = "force-dynamic";

const MAX_POSTS_PER_RUN = Math.min(50, Math.max(1, Number.parseInt(process.env.DELETE_EXPIRED_POSTS_LIMIT || "30", 10) || 30));
const DELETE_DELAY_MS = Math.min(5_000, Math.max(100, Number.parseInt(process.env.DELETE_EXPIRED_POSTS_DELAY_MS || "500", 10) || 500));

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;
  const lock = await acquireCronLock("expired-channel-post-deletion", 1800);
  if (!lock) return NextResponse.json({ success: false, message: "Expired post deletion is already running" }, { status: 409 });
  try {
    const pendingRecovery = await markStalePendingDeliveryPosts(
      Number.parseInt(process.env.PENDING_DELIVERY_TIMEOUT_MINUTES || "10", 10)
    );
    const lifetimeHours = await getConfiguredPostLifetimeHours();
    const summary = await deleteCampaignPosts({
      olderThan24Hours: true,
      lifetimeHours,
      batchSize: MAX_POSTS_PER_RUN,
      maxPostsPerRun: MAX_POSTS_PER_RUN,
      batchDelayMs: DELETE_DELAY_MS,
    });
    console.info("Expired channel post deletion complete", {
      checked: summary.checked, deleted: summary.deleted, failed: summary.failed,
      skipped: summary.skipped, lifetime_hours: lifetimeHours,
    });
    return NextResponse.json({
      success: true,
      lifetime_hours: lifetimeHours,
      max_posts_per_run: MAX_POSTS_PER_RUN,
      delay_ms: DELETE_DELAY_MS,
      checked: summary.checked,
      deleted: summary.deleted,
      failed: summary.failed,
      skipped: summary.skipped,
      failed_ids: summary.failedIds,
      pending_recovery: pendingRecovery,
      details: summary.details,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "expired_post_deletion_failed";
    console.error("Expired channel post deletion failed", { error: message });
    return NextResponse.json({ success: false, message }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
