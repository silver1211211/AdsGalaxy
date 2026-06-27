import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { deleteActiveCampaignPosts } from "@/lib/campaignPostDeletion";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";

const LIFECYCLE_COLUMNS = ["paused_at", "resume_locked_until", "pause_reason", "completed_at"];

type ColumnRow = RowDataPacket & {
  COLUMN_NAME: string;
};

type CampaignActionRow = RowDataPacket & {
  id: number;
  status: string;
  budget: string | number;
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
    return { total: 0, deleted: 0, failed: 1, failedIds: [], details: [{ id: 0, status: "error", reason: message }] };
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const { id } = await params;
    const { action } = await request.json();
    const validActions = new Set(["pause", "resume", "delete"]);

    if (!validActions.has(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const [rows] = await pool.query<CampaignActionRow[]>("SELECT id, status, budget FROM campaigns WHERE id = ?", [id]);
    if (rows.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const campaign = rows[0];
    const oldStatus = campaign.status;
    const columns = await getCampaignColumns();
    let deletion = null;
    let newStatus = oldStatus;

    if (action === "pause") {
      deletion = await deleteCampaignPostsSafely(id);
      const updates = ["status = 'paused'"];

      if (columns.has("pause_reason")) updates.push("pause_reason = 'admin_paused'");
      if (columns.has("paused_at")) updates.push("paused_at = NOW()");
      if (columns.has("resume_locked_until")) updates.push("resume_locked_until = NULL");

      await pool.query(`UPDATE campaigns SET ${updates.join(", ")} WHERE id = ?`, [id]);
      newStatus = "paused";
    }

    if (action === "resume") {
      if (parseFloat(String(campaign.budget || "0")) <= 0) {
        return NextResponse.json({ error: "Campaign budget is exhausted. Add budget before resuming." }, { status: 400 });
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
      action: `campaign_${action}`,
      entityType: "campaign",
      entityId: id,
      reason: `admin_${action}`,
      metadata: {
        old_status: oldStatus,
        new_status: newStatus,
        deletion,
      },
    });

    return NextResponse.json({ success: true, status: newStatus, deletion });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    console.error("Admin Campaign Action Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
