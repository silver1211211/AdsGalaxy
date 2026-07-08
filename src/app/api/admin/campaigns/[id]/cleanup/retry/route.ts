import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/adminAuth";
import { retryCampaignPostCleanup } from "@/lib/campaignPostDeletion";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { acquireCronLock, releaseCronLock } from "@/lib/cronSecurity";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin, response } = await requireAdminPermission("operate");
  if (response) return response;

  const { id } = await params;
  let lock: { lockName: string; ownerToken: string } | null = null;

  try {
    lock = await acquireCronLock(`admin-campaign-cleanup-retry-${id}`, 600);
    if (!lock) {
      return NextResponse.json({ error: "Cleanup retry is already running for this campaign." }, { status: 409 });
    }

    const cleanup = await retryCampaignPostCleanup(id);
    await recordAdminActionAudit({
      adminId: admin?.id,
      action: "campaign_retry_cleanup",
      entityType: "campaign",
      entityId: id,
      reason: "admin_retry_cleanup_endpoint",
      metadata: { cleanup },
    });

    return NextResponse.json({ success: true, cleanup });
  } catch (error) {
    const message = error instanceof Error ? error.message : "campaign_cleanup_retry_failed";
    console.error("Admin campaign cleanup retry failed", { campaign_id: id, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
