import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { deleteActiveCampaignPosts } from "@/lib/campaignPostDeletion";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { settleCampaignEngagementBeforeDeletion, type CampaignSettlementBeforeDeletionResult } from "@/lib/channelSettlement";

const LIFECYCLE_COLUMNS = ["paused_at", "resume_locked_until", "pause_reason", "completed_at"];

type ColumnRow = RowDataPacket & {
  COLUMN_NAME: string;
};

type CampaignActionRow = RowDataPacket & {
  id: number;
  status: string;
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
    return { checked: 0, total: 0, deleted: 0, failed: 1, skipped: 0, failedIds: [], details: [{ id: 0, status: "error", reason: message }] };
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin, response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const { id } = await params;
    const { action } = await request.json();
    const validActions = new Set(["pause", "resume", "delete"]);

    if (!validActions.has(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const [rows] = await pool.query<CampaignActionRow[]>("SELECT id, status, budget, cpm, user_id FROM campaigns WHERE id = ?", [id]);
    if (rows.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const campaign = rows[0];
    const oldStatus = campaign.status;
    const columns = await getCampaignColumns();
    let deletion = null;
    let newStatus = oldStatus;
    let settlement: CampaignSettlementBeforeDeletionResult | null = null;

    if (action === "pause" || action === "delete") {
      // Settle any already-delivered but not-yet-billed views/clicks before the
      // campaign's active posts are removed, so the publisher isn't left unpaid
      // for engagement the advertiser already received. Must run while the
      // campaign is still whatever status let it accrue delivered posts (the
      // settlement engine only considers active campaigns; a no-op for already
      // paused/exhausted campaigns and for broadcast/bot campaigns).
      settlement = await settleCampaignEngagementBeforeDeletion(Number(id), action === "delete" ? "admin_delete" : "admin_pause");
      if (!settlement.ok) {
        const blocker = settlement.failedDetails[0];
        console.error("Admin campaign action blocked by settlement", {
          campaign_id: id,
          action,
          failed_posts: settlement.failedPosts,
          blocker_post_id: blocker?.postId || null,
          blocker_reason: blocker?.reason || settlement.error || "unknown_settlement_error",
          settlement,
        });
        return NextResponse.json({
          error: blocker
            ? `Campaign remains active because post #${blocker.postId} could not be settled safely. Review the settlement log and retry.`
            : "Campaign remains active because outstanding engagement could not be settled safely. Review the settlement log and retry.",
          settlement,
        }, { status: 409 });
      }
    }

    if (action === "pause") {
      deletion = await deleteCampaignPostsSafely(id);
      if (deletion.failed > 0) {
        console.error("Admin campaign pause blocked by post cleanup", { campaign_id: id, action, deletion });
        return NextResponse.json({
          error: `Campaign remains active because ${deletion.failed} active post${deletion.failed === 1 ? "" : "s"} could not be removed safely. Review the post cleanup details and retry.`,
          deletion,
          settlement,
        }, { status: 409 });
      }
      const updates = ["status = 'paused'"];

      if (columns.has("pause_reason")) updates.push("pause_reason = 'admin_paused'");
      if (columns.has("paused_at")) updates.push("paused_at = NOW()");
      if (columns.has("resume_locked_until")) updates.push("resume_locked_until = NULL");

      await pool.query(`UPDATE campaigns SET ${updates.join(", ")} WHERE id = ?`, [id]);
      newStatus = "paused";
    }

    if (action === "resume") {
      // Resuming must not require a locked/reserved campaign budget — only that
      // the advertiser's own ad_balance can cover at least the next billable
      // unit at this campaign's CPM rate. Settlement itself is unchanged.
      if (parseFloat(String(campaign.budget || "0")) <= 0) {
        const unitPrice = parseFloat(String(campaign.cpm || "0")) / 1000;
        const [balanceRows] = await pool.query<RowDataPacket[]>(
          "SELECT ad_balance FROM users WHERE id = ?",
          [campaign.user_id]
        );
        const adBalance = parseFloat(String(balanceRows[0]?.ad_balance ?? "0"));
        if (!(unitPrice > 0) || adBalance < unitPrice) {
          return NextResponse.json({
            error: "Insufficient ad balance to resume this campaign. The advertiser must add funds to cover at least the next billable impression.",
          }, { status: 400 });
        }
      }

      const updates = ["status = 'active'"];

      if (columns.has("pause_reason")) updates.push("pause_reason = NULL");
      if (columns.has("paused_at")) updates.push("paused_at = NULL");
      if (columns.has("resume_locked_until")) updates.push("resume_locked_until = NULL");

      await pool.query(`UPDATE campaigns SET ${updates.join(", ")} WHERE id = ?`, [id]);
      newStatus = "active";
    }

    if (action === "delete") {
      deletion = await deleteCampaignPostsSafely(id);
      const updates = ["status = 'deleted'"];

      if (columns.has("pause_reason")) updates.push("pause_reason = 'admin_deleted'");
      if (columns.has("completed_at")) updates.push("completed_at = NOW()");

      await pool.query(`UPDATE campaigns SET ${updates.join(", ")} WHERE id = ?`, [id]);
      newStatus = "deleted";
    }

    await recordAdminActionAudit({
      adminId: admin?.id,
      action: `campaign_${action}`,
      entityType: "campaign",
      entityId: id,
      reason: `admin_${action}`,
      metadata: {
        old_status: oldStatus,
        new_status: newStatus,
        deletion,
        settlement,
      },
    });

    return NextResponse.json({ success: true, status: newStatus, deletion, settlement });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    console.error("Admin Campaign Action Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
