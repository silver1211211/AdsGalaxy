import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { deleteActiveCampaignPosts } from "@/lib/campaignPostDeletion";

const REQUIRED_CAMPAIGN_LIFECYCLE_COLUMNS = [
  "paused_at",
  "resume_locked_until",
  "completed_at",
  "budget_exhausted_at",
  "pause_reason",
  "auto_reactivate",
];

type ColumnRow = RowDataPacket & {
  COLUMN_NAME: string;
};

type CountRow = RowDataPacket & {
  count: number;
};

type CampaignRow = RowDataPacket & {
  id: number;
  budget: string | number;
  name?: string;
};

export async function assertCampaignLifecycleColumns() {
  const [rows] = await pool.query<ColumnRow[]>(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'campaigns'
      AND COLUMN_NAME IN (?)
  `, [REQUIRED_CAMPAIGN_LIFECYCLE_COLUMNS]);

  const found = new Set(rows.map(row => row.COLUMN_NAME));
  const missing = REQUIRED_CAMPAIGN_LIFECYCLE_COLUMNS.filter(column => !found.has(column));

  if (missing.length > 0) {
    throw new Error(`Campaign lifecycle migration is missing columns: ${missing.join(", ")}`);
  }
}

export async function hasAdminActionAuditsTable() {
  const [rows] = await pool.query<CountRow[]>(`
    SELECT COUNT(*) as count
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'admin_action_audits'
  `);

  return rows[0]?.count > 0;
}

export async function recordAdminActionAudit(input: {
  adminId?: number | null;
  action: string;
  entityType: string;
  entityId: number | string;
  reason?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    if (!(await hasAdminActionAuditsTable())) {
      console.warn("admin_action_audits table is missing; skipping admin audit log");
      return;
    }

    await pool.query(`
      INSERT INTO admin_action_audits (admin_id, action, entity_type, entity_id, reason, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      input.adminId || null,
      input.action,
      input.entityType,
      input.entityId,
      input.reason || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown audit logging error";
    console.warn("Failed to record admin action audit", {
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId,
      error: message,
    });
  }
}

export async function markCampaignBudgetExhausted(campaignId: number | string, conn?: PoolConnection) {
  await assertCampaignLifecycleColumns();
  const executor = conn || pool;

  await executor.query(`
    UPDATE campaigns
    SET status = 'budget_exhausted',
      budget = 0,
      budget_exhausted_at = NOW(),
      completed_at = NULL,
      pause_reason = 'budget_exhausted'
    WHERE id = ?
  `, [campaignId]);
}

export async function exhaustCampaignAndDeletePosts(campaignId: number | string) {
  await markCampaignBudgetExhausted(campaignId);
  return deleteActiveCampaignPosts(campaignId);
}

export async function adminResumeCampaign(campaignId: number | string) {
  await assertCampaignLifecycleColumns();

  const [campaignRows] = await pool.query<CampaignRow[]>(
    "SELECT id, budget FROM campaigns WHERE id = ?",
    [campaignId]
  );

  if (campaignRows.length === 0) {
    throw new Error("Campaign not found");
  }

  const budget = parseFloat(String(campaignRows[0].budget || "0"));
  if (budget <= 0) {
    throw new Error("Campaign budget is exhausted. Add budget before resuming.");
  }

  await pool.query(`
    UPDATE campaigns
    SET status = 'active',
      paused_at = NULL,
      resume_locked_until = NULL,
      pause_reason = NULL
    WHERE id = ?
  `, [campaignId]);
}
