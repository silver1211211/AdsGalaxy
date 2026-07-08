import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { checkAdminAuth, requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";

type ColumnRow = RowDataPacket & { COLUMN_NAME: string };
type GenericRow = RowDataPacket & Record<string, unknown>;

const EDITABLE_CAMPAIGN_FIELDS = {
  name: { type: "string", maxLength: 255 },
  campaign_title: { type: "string", maxLength: 255 },
  message_text: { type: "string", maxLength: 4096 },
  link: { type: "string", maxLength: 512 },
  button_text: { type: "string", maxLength: 64 },
  category: { type: "string", maxLength: 64 },
  cpm: { type: "number", min: 0 },
  cpc: { type: "number", min: 0 },
} as const;

type EditableCampaignField = keyof typeof EDITABLE_CAMPAIGN_FIELDS;

async function getCampaignPostColumns() {
  const [rows] = await pool.query<ColumnRow[]>(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'campaign_posts'
  `);

  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function getCampaignColumns() {
  const [rows] = await pool.query<ColumnRow[]>(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'campaigns'
  `);

  return new Set(rows.map((row) => row.COLUMN_NAME));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const postColumns = await getCampaignPostColumns();
    const deletedAtExpr = postColumns.has("deleted_at") ? "cp.deleted_at" : "NULL";
    const deletedPostsExpr = postColumns.has("deleted_at")
      ? "SUM(CASE WHEN cp.status = 'deleted' OR cp.deleted_at IS NOT NULL THEN 1 ELSE 0 END)"
      : "SUM(CASE WHEN cp.status = 'deleted' THEN 1 ELSE 0 END)";
    const deleteFailedExpr = postColumns.has("delete_failed_reason")
      ? "SUM(CASE WHEN cp.status = 'delete_failed' OR cp.delete_failed_reason IS NOT NULL THEN 1 ELSE 0 END)"
      : "SUM(CASE WHEN cp.status = 'delete_failed' THEN 1 ELSE 0 END)";
    const totalViewsExpr = postColumns.has("views") ? "COALESCE(SUM(cp.views), 0)" : "0";
    const lastViewUpdateExpr = postColumns.has("last_views_update") ? "MAX(cp.last_views_update)" : "NULL";
    const placementViewsExpr = postColumns.has("views") ? "cp.views" : "0";
    const messageIdExpr = postColumns.has("message_id") ? "cp.message_id" : "NULL";
    const deleteAttemptsExpr = postColumns.has("delete_attempts") ? "cp.delete_attempts" : "NULL";
    const deleteFailedReasonExpr = postColumns.has("delete_failed_reason") ? "cp.delete_failed_reason" : "NULL";
    const cleanupAttemptedAtExpr = postColumns.has("cleanup_attempted_at") ? "cp.cleanup_attempted_at" : "NULL";
    const cleanupStatusExpr = postColumns.has("cleanup_status") ? "cp.cleanup_status" : "NULL";
    const cleanupCompletedAtExpr = postColumns.has("cleanup_completed_at") ? "cp.cleanup_completed_at" : "NULL";
    const cleanupErrorExpr = postColumns.has("cleanup_error") ? "cp.cleanup_error" : deleteFailedReasonExpr;
    const cleanupRetryCountExpr = postColumns.has("cleanup_retry_count") ? "cp.cleanup_retry_count" : deleteAttemptsExpr;
    const cleanupPendingExpr = postColumns.has("cleanup_status")
      ? "SUM(CASE WHEN cp.cleanup_status = 'pending' THEN 1 ELSE 0 END)"
      : "SUM(CASE WHEN cp.status = 'cleanup_pending' THEN 1 ELSE 0 END)";
    const cleanupSuccessExpr = postColumns.has("cleanup_status")
      ? "SUM(CASE WHEN cp.cleanup_status = 'success' THEN 1 ELSE 0 END)"
      : deletedPostsExpr;
    const cleanupRetryExpr = postColumns.has("cleanup_status")
      ? "SUM(CASE WHEN cp.cleanup_status = 'retry' THEN 1 ELSE 0 END)"
      : "0";
    const cleanupFailedExpr = postColumns.has("cleanup_status")
      ? "SUM(CASE WHEN cp.cleanup_status = 'failed' THEN 1 ELSE 0 END)"
      : deleteFailedExpr;

    const [campaignRows] = await pool.query<GenericRow[]>(`
      SELECT c.*, u.first_name, u.last_name, u.username, u.telegram_id
      FROM campaigns c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `, [id]);

    if (campaignRows.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const [metricsRows] = await pool.query<GenericRow[]>(`
      SELECT
        COUNT(*) as total_posts,
        SUM(CASE WHEN cp.status IN ('active', 'posted', 'sent') THEN 1 ELSE 0 END) as active_posts,
        SUM(CASE WHEN cp.status = 'cleanup_pending' THEN 1 ELSE 0 END) as cleanup_pending_posts,
        ${cleanupPendingExpr} as cleanup_status_pending_posts,
        ${cleanupSuccessExpr} as cleanup_status_success_posts,
        ${cleanupRetryExpr} as cleanup_status_retry_posts,
        ${cleanupFailedExpr} as cleanup_status_failed_posts,
        SUM(CASE WHEN cp.status = 'settlement_pending' THEN 1 ELSE 0 END) as settlement_pending_posts,
        SUM(CASE WHEN cp.status = 'replaced' THEN 1 ELSE 0 END) as replaced_posts,
        SUM(CASE WHEN cp.status = 'already_missing' THEN 1 ELSE 0 END) as already_missing_posts,
        ${deletedPostsExpr} as deleted_posts,
        ${deleteFailedExpr} as delete_failed_posts,
        ${totalViewsExpr} as total_views,
        COUNT(DISTINCT cp.channel_id) as channels_posted_to,
        MAX(cp.created_at) as last_posted_at,
        ${lastViewUpdateExpr} as last_view_update
      FROM campaign_posts cp
      WHERE cp.campaign_id = ?
    `, [id]);

    const [clickRows] = await pool.query<Array<RowDataPacket & { total_clicks: number | string }>>(
      "SELECT COUNT(*) as total_clicks FROM campaign_clicks WHERE campaign_id = ?",
      [id]
    );

    const [financialRows] = await pool.query<GenericRow[]>(
      `SELECT
        CASE WHEN c.type = 'broadcast'
          THEN COALESCE((SELECT SUM(bd.cost) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.status = 'sent'), 0)
          ELSE COALESCE(c.channel_spend, 0)
        END AS spend,
        (SELECT COUNT(*) FROM campaigns approved WHERE approved.user_id = c.user_id AND approved.status IN ('active', 'completed', 'budget_exhausted')) AS approved_count,
        (SELECT COUNT(*) FROM campaigns rejected WHERE rejected.user_id = c.user_id AND rejected.status = 'rejected') AS rejected_count
       FROM campaigns c WHERE c.id = ?`,
      [id]
    );

    const [placements] = await pool.query<GenericRow[]>(`
      SELECT
        cp.id,
        cp.channel_id,
        cp.channel_username,
        ${messageIdExpr} as message_id,
        cp.status,
        ${placementViewsExpr} as views,
        cp.created_at,
        ${deletedAtExpr} as deleted_at,
        ${deleteAttemptsExpr} as delete_attempts,
        ${deleteFailedReasonExpr} as delete_failed_reason,
        ${cleanupAttemptedAtExpr} as cleanup_attempted_at,
        ${cleanupStatusExpr} as cleanup_status,
        ${cleanupCompletedAtExpr} as cleanup_completed_at,
        ${cleanupErrorExpr} as cleanup_error,
        ${cleanupRetryCountExpr} as cleanup_retry_count,
        (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id = cp.id) as clicks
      FROM campaign_posts cp
      WHERE cp.campaign_id = ?
      ORDER BY cp.created_at DESC
      LIMIT 200
    `, [id]);

    const metrics = metricsRows[0] || {};
    const totalViews = Number(metrics.total_views || 0);
    const totalClicks = Number(clickRows[0]?.total_clicks || 0);

    return NextResponse.json({
      campaign: { ...campaignRows[0], ...financialRows[0] },
      metrics: {
        ...metrics,
        total_clicks: totalClicks,
        ctr: totalViews > 0 ? totalClicks / totalViews : 0,
      },
      placements,
    });
  } catch (error: unknown) {
    console.error("Admin Campaign Details API Error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin, response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;
    const fields = Object.keys(body);
    const unknownFields = fields.filter((field) => !(field in EDITABLE_CAMPAIGN_FIELDS));
    if (unknownFields.length > 0) {
      return NextResponse.json({ error: `Unknown or read-only field: ${unknownFields[0]}` }, { status: 400 });
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const [campaignRows] = await pool.query<GenericRow[]>("SELECT * FROM campaigns WHERE id = ?", [id]);
    if (campaignRows.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const campaign = campaignRows[0];
    const campaignColumns = await getCampaignColumns();
    const updates: string[] = [];
    const values: unknown[] = [];
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    for (const field of fields as EditableCampaignField[]) {
      if (!campaignColumns.has(field)) {
        return NextResponse.json({ error: `${field} is not available in this campaign schema` }, { status: 400 });
      }
      const config = EDITABLE_CAMPAIGN_FIELDS[field];
      const rawValue = body[field];
      let value: string | number;

      if (config.type === "string") {
        if (typeof rawValue !== "string") {
          return NextResponse.json({ error: `${field} must be a string` }, { status: 400 });
        }
        value = rawValue.trim();
        if (value.length === 0) {
          return NextResponse.json({ error: `${field} cannot be empty` }, { status: 400 });
        }
        if (value.length > config.maxLength) {
          return NextResponse.json({ error: `${field} exceeds ${config.maxLength} characters` }, { status: 400 });
        }
      } else {
        const numericValue = typeof rawValue === "number" ? rawValue : Number(rawValue);
        if (!Number.isFinite(numericValue) || numericValue < config.min) {
          return NextResponse.json({ error: `${field} must be a non-negative number` }, { status: 400 });
        }
        value = numericValue;
      }

      if (String(campaign[field] ?? "") === String(value)) continue;
      oldValues[field] = campaign[field] ?? null;
      newValues[field] = value;
      updates.push(`${field} = ?`);
      values.push(value);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No changes to save" }, { status: 400 });
    }

    values.push(id);
    await pool.query(`UPDATE campaigns SET ${updates.join(", ")}, updated_at = NOW() WHERE id = ?`, values);

    await recordAdminActionAudit({
      adminId: admin?.id,
      action: "campaign_edit",
      entityType: "campaign",
      entityId: id,
      reason: "admin_campaign_edit",
      metadata: {
        admin_id: admin?.id || null,
        campaign_id: id,
        edited_fields: Object.keys(newValues),
        old_values: oldValues,
        new_values: newValues,
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      campaign_id: id,
      updated_fields: Object.keys(newValues),
    });
  } catch (error: unknown) {
    console.error("Admin Campaign Edit API Error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal Server Error" }, { status: 500 });
  }
}
