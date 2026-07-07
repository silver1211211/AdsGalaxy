import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";

async function getCampaignPostColumns() {
  const [rows]: any = await pool.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'campaign_posts'
  `);

  return new Set(rows.map((row: any) => row.COLUMN_NAME));
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

    const [campaignRows]: any = await pool.query(`
      SELECT c.*, u.first_name, u.last_name, u.username, u.telegram_id
      FROM campaigns c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `, [id]);

    if (campaignRows.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const [metricsRows]: any = await pool.query(`
      SELECT
        COUNT(*) as total_posts,
        SUM(CASE WHEN cp.status IN ('active', 'posted', 'sent') THEN 1 ELSE 0 END) as active_posts,
        SUM(CASE WHEN cp.status = 'cleanup_pending' THEN 1 ELSE 0 END) as cleanup_pending_posts,
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

    const [clickRows]: any = await pool.query(
      "SELECT COUNT(*) as total_clicks FROM campaign_clicks WHERE campaign_id = ?",
      [id]
    );

    const [financialRows]: any = await pool.query(
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

    const [placements]: any = await pool.query(`
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
  } catch (error: any) {
    console.error("Admin Campaign Details API Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
