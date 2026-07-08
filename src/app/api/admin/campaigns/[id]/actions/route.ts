import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { deleteActiveCampaignPosts, retryCampaignPostCleanup } from "@/lib/campaignPostDeletion";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { forceRefreshCampaignStatistics, forceSettleCampaignDeltas, refreshAndSettleCampaign } from "@/lib/campaignAdminOperations";
import { settleCampaignEngagementBeforeDeletion, type CampaignSettlementBeforeDeletionResult } from "@/lib/channelSettlement";
import { acquireCronLock, releaseCronLock } from "@/lib/cronSecurity";
import { CAMPAIGN_LIFECYCLE_ACTION_SPECS, isCampaignLifecycleAction, type CampaignLifecycleAction } from "@/lib/campaignLifecycleActions";

const LIFECYCLE_COLUMNS = [
  "paused_at",
  "resume_locked_until",
  "pause_reason",
  "completed_at",
  "channel_settlement_finalized_at",
  "telegram_cleanup_status",
  "telegram_cleanup_attempted_at",
  "archived_at",
];

type ColumnRow = RowDataPacket & {
  COLUMN_NAME: string;
};

type CampaignActionRow = RowDataPacket & {
  id: number;
  status: string;
  pause_reason: string | null;
  budget: string | number;
  cpm: string | number;
  user_id: number;
};

async function getCampaignColumns() {
  const [rows] = await pool.query<ColumnRow[]>(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'campaigns'
      AND COLUMN_NAME IN (?)
  `, [LIFECYCLE_COLUMNS]);

  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function deleteCampaignPostsSafely(campaignId: string) {
  try {
    return await deleteActiveCampaignPosts(campaignId);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Admin campaign post deletion failed";
    console.warn("Admin campaign post deletion failed", {
      campaign_id: campaignId,
      error: message,
    });
    return { checked: 0, total: 0, deleted: 0, failed: 0, retry: 1, skipped: 0, failedIds: [], details: [{ id: 0, status: "error", cleanup_status: "retry" as const, reason: message }] };
  }
}

type CleanupSummary = Awaited<ReturnType<typeof deleteCampaignPostsSafely>>;

async function markPaused(campaignId: string, reason: string, columns: Set<string>) {
  const updates = ["status = 'paused'"];
  const params: string[] = [];

  if (columns.has("pause_reason")) {
    updates.push("pause_reason = ?");
    params.push(reason);
  }
  if (columns.has("paused_at")) updates.push("paused_at = COALESCE(paused_at, NOW())");
  if (columns.has("resume_locked_until")) updates.push("resume_locked_until = NULL");

  params.push(campaignId);
  await pool.query(`UPDATE campaigns SET ${updates.join(", ")} WHERE id = ? AND status <> 'deleted'`, params);
}

async function markFinalSettlementComplete(campaignId: string, columns: Set<string>) {
  if (!columns.has("channel_settlement_finalized_at")) return;
  await pool.query(
    "UPDATE campaigns SET channel_settlement_finalized_at = COALESCE(channel_settlement_finalized_at, NOW()) WHERE id = ?",
    [campaignId]
  );
}

async function markCleanupStatus(campaignId: string, columns: Set<string>, deletion: CleanupSummary | null) {
  if (!columns.has("telegram_cleanup_status") && !columns.has("telegram_cleanup_attempted_at")) return;
  const status = !deletion
    ? "not_attempted"
    : deletion.retry > 0
      ? "retry"
      : deletion.failed > 0
      ? "failed"
      : deletion.deleted > 0 || deletion.total > 0
        ? "complete"
        : "not_needed";
  const updates: string[] = [];
  const params: string[] = [];
  if (columns.has("telegram_cleanup_status")) {
    updates.push("telegram_cleanup_status = ?");
    params.push(status);
  }
  if (columns.has("telegram_cleanup_attempted_at")) updates.push("telegram_cleanup_attempted_at = NOW()");
  params.push(campaignId);
  await pool.query(`UPDATE campaigns SET ${updates.join(", ")} WHERE id = ?`, params);
}

async function resumeCampaign(campaign: CampaignActionRow, campaignId: string, columns: Set<string>) {
  const terminalStatuses = ["deleted", "completed", "rejected", "budget_exhausted"];
  if (terminalStatuses.includes(campaign.status)) {
    return `Cannot resume ${campaign.status} campaigns.`;
  }

  if (campaign.status !== "paused") {
    return "Campaign is not paused.";
  }

  if (parseFloat(String(campaign.budget || "0")) <= 0) {
    const unitPrice = parseFloat(String(campaign.cpm || "0")) / 1000;
    const [balanceRows] = await pool.query<RowDataPacket[]>(
      "SELECT ad_balance FROM users WHERE id = ?",
      [campaign.user_id]
    );
    const adBalance = parseFloat(String(balanceRows[0]?.ad_balance ?? "0"));
    if (!(unitPrice > 0) || adBalance < unitPrice) {
      return "Insufficient ad balance to resume this campaign. The advertiser must add funds to cover at least the next billable impression.";
    }
  }

  const updates = ["status = 'active'"];
  if (columns.has("pause_reason")) updates.push("pause_reason = NULL");
  if (columns.has("paused_at")) updates.push("paused_at = NULL");
  if (columns.has("resume_locked_until")) updates.push("resume_locked_until = NULL");

  await pool.query(`UPDATE campaigns SET ${updates.join(", ")} WHERE id = ?`, [campaignId]);
  return null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin, response } = await requireAdminPermission("operate");
  if (response) return response;

  let lock: { lockName: string; ownerToken: string } | null = null;
  try {
    const { id } = await params;
    const { action } = await request.json();

    if (!isCampaignLifecycleAction(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    const lifecycleAction: CampaignLifecycleAction = action;
    const spec = CAMPAIGN_LIFECYCLE_ACTION_SPECS[lifecycleAction];

    lock = await acquireCronLock(`admin-campaign-action-${id}`, 600);
    if (!lock) {
      return NextResponse.json({
        error: "This campaign is already being updated. Please wait for the current cleanup to finish and retry.",
      }, { status: 409 });
    }

    const [rows] = await pool.query<CampaignActionRow[]>("SELECT id, status, pause_reason, budget, cpm, user_id FROM campaigns WHERE id = ?", [id]);
    if (rows.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const campaign = rows[0];
    const oldStatus = campaign.status;
    const columns = await getCampaignColumns();
    let deletion: CleanupSummary | null = null;
    let newStatus = oldStatus;
    let settlement: CampaignSettlementBeforeDeletionResult | null = null;
    let operationResult: Record<string, unknown> | null = null;

    if (lifecycleAction === "force_refresh_stats") {
      operationResult = await forceRefreshCampaignStatistics(Number(id));
      await recordAdminActionAudit({
        adminId: admin?.id,
        action: "campaign_force_refresh_stats",
        entityType: "campaign",
        entityId: id,
        reason: "admin_force_refresh_stats",
        metadata: { result: operationResult },
      });
      return NextResponse.json({ success: true, status: newStatus, refresh: operationResult });
    }

    if (lifecycleAction === "force_settlement") {
      operationResult = await forceSettleCampaignDeltas(Number(id));
      await recordAdminActionAudit({
        adminId: admin?.id,
        action: "campaign_force_settlement",
        entityType: "campaign",
        entityId: id,
        reason: "admin_force_settlement",
        metadata: { result: operationResult },
      });
      return NextResponse.json({ success: true, status: newStatus, settlement: operationResult });
    }

    if (lifecycleAction === "refresh_and_settle") {
      operationResult = await refreshAndSettleCampaign(Number(id));
      await recordAdminActionAudit({
        adminId: admin?.id,
        action: "campaign_refresh_and_settle",
        entityType: "campaign",
        entityId: id,
        reason: "admin_refresh_and_settle",
        metadata: { result: operationResult },
      });
      return NextResponse.json({ success: true, status: newStatus, ...operationResult });
    }

    if (spec.stopsDelivery) {
      const pauseReason = lifecycleAction === "pause_only"
        ? "admin_pause_only"
        : lifecycleAction === "delete"
          ? "admin_delete_pending_finalization"
          : "admin_pause_finalizing";
      await markPaused(id, pauseReason, columns);
      newStatus = "paused";
    }

    if (spec.settlesFinancials) {
      settlement = await settleCampaignEngagementBeforeDeletion(
        Number(id),
        lifecycleAction === "delete" ? "admin_delete" : "admin_pause",
        { includePausedCampaign: true }
      );
      if (!settlement.ok) {
        const blocker = settlement.failedDetails[0];
        console.error("Admin campaign action blocked by settlement", {
          campaign_id: id,
          action: lifecycleAction,
          failed_posts: settlement.failedPosts,
          blocker_post_id: blocker?.postId || null,
          blocker_reason: blocker?.reason || settlement.error || "unknown_settlement_error",
          settlement,
        });
        return NextResponse.json({
          error: blocker
            ? `Campaign remains paused because post #${blocker.postId} could not be settled safely. Review the settlement log and retry.`
            : "Campaign remains paused because outstanding engagement could not be settled safely. Review the settlement log and retry.",
          settlement,
        }, { status: 409 });
      }
      await markFinalSettlementComplete(id, columns);
      if (lifecycleAction === "pause" || lifecycleAction === "pause_finalize") {
        await markPaused(id, "admin_pause_finalized", columns);
      }
    }

    if (spec.cleansTelegramPosts) {
      deletion = lifecycleAction === "retry_cleanup"
        ? await retryCampaignPostCleanup(id)
        : await deleteCampaignPostsSafely(id);
      await markCleanupStatus(id, columns, deletion);
      if (deletion.failed > 0) {
        console.error("Admin campaign cleanup had post cleanup failures", { campaign_id: id, action: lifecycleAction, deletion });
      }
    }

    if (lifecycleAction === "resume") {
      const resumeError = await resumeCampaign(campaign, id, columns);
      if (resumeError) return NextResponse.json({ error: resumeError }, { status: 400 });
      newStatus = "active";
    }

    if (lifecycleAction === "delete") {
      const updates = ["status = 'deleted'"];
      if (columns.has("pause_reason")) updates.push("pause_reason = 'admin_deleted'");
      if (columns.has("completed_at")) updates.push("completed_at = NOW()");
      if (columns.has("archived_at")) updates.push("archived_at = COALESCE(archived_at, NOW())");

      await pool.query(`UPDATE campaigns SET ${updates.join(", ")} WHERE id = ?`, [id]);
      newStatus = "deleted";
    }

    await recordAdminActionAudit({
      adminId: admin?.id,
      action: `campaign_${lifecycleAction}`,
      entityType: "campaign",
      entityId: id,
      reason: `admin_${lifecycleAction}`,
      metadata: {
        old_status: oldStatus,
        new_status: newStatus,
        lifecycle: spec,
        deletion,
        settlement,
      },
    });

    const cleanupIncomplete = Boolean(deletion && (deletion.failed > 0 || deletion.retry > 0));
    const cleanupIncompleteCount = (deletion?.failed || 0) + (deletion?.retry || 0);
    return NextResponse.json({
      success: true,
      status: newStatus,
      warning: cleanupIncomplete
        ? `${cleanupIncompleteCount} post${cleanupIncompleteCount === 1 ? "" : "s"} could not be deleted from Telegram and were marked for review or retry.`
        : undefined,
      deletion,
      settlement,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    console.error("Admin Campaign Action Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
