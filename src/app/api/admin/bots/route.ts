import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";
import { sendTelegramMessage } from "@/lib/telegram";
import { reactivateBotAfterHealthCheck } from "@/lib/botLifecycle";

export async function GET(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "10");
  const statusFilter = searchParams.get("status") || "all";
  const qualityFilter = searchParams.get("quality") || "all";
  const riskFilter = searchParams.get("risk") || "all";
  const search = searchParams.get("search") || "";
  const offset = (page - 1) * limit;

  try {
    let query = `
      SELECT
        b.id,
        b.user_id,
        b.bot_username,
        b.bot_name,
        b.posts_per_day,
        b.continents,
        b.categories,
        b.status,
        b.paused_reason,
        b.suggested_fix,
        b.health_status,
        b.last_successful_broadcast_at,
        b.last_failure_at,
        b.failure_reason,
        COALESCE(b.traffic_quality_score, 60) as traffic_quality_score,
        COALESCE(b.traffic_quality_tier, 'good') as traffic_quality_tier,
        COALESCE(b.traffic_risk_level, 'low') as traffic_risk_level,
        b.traffic_quality_updated_at,
        b.is_deleted,
        b.created_at,
        b.updated_at,
        u.first_name,
        u.last_name,
        u.username AS owner_username,
        u.telegram_id as owner_telegram_id,
        CASE
          WHEN b.status = 'active' AND COALESCE(b.health_status, 'active') = 'active'
            THEN (SELECT COUNT(*) FROM bot_users WHERE bot_id = b.id AND is_active = TRUE AND status = 'active')
          ELSE 0
        END as active_count,
        (SELECT COUNT(*) FROM bot_users WHERE bot_id = b.id AND (is_active = FALSE OR status != 'active')) as blocked_count
      FROM bots b
      LEFT JOIN users u ON b.user_id = u.id
    `;
    let countQuery = "SELECT COUNT(*) as total FROM bots b LEFT JOIN users u ON b.user_id = u.id";
    const queryParams: any[] = [];

    let whereClause = " WHERE b.is_deleted = FALSE";
    
    if (statusFilter !== "all") {
      whereClause += " AND b.status = ?";
      queryParams.push(statusFilter);
    }

    if (qualityFilter !== "all") {
      whereClause += " AND COALESCE(b.traffic_quality_tier, 'good') = ?";
      queryParams.push(qualityFilter);
    }

    if (riskFilter !== "all") {
      whereClause += " AND COALESCE(b.traffic_risk_level, 'low') = ?";
      queryParams.push(riskFilter);
    }

    if (search) {
      whereClause += ` AND (
        b.bot_name LIKE ? OR 
        b.bot_username LIKE ? OR 
        u.first_name LIKE ? OR 
        u.last_name LIKE ? OR 
        u.username LIKE ? OR 
        u.telegram_id LIKE ?
      )`;
      const searchVal = `%${search}%`;
      queryParams.push(searchVal, searchVal, searchVal, searchVal, searchVal, searchVal);
    }

    query += whereClause + " ORDER BY b.id DESC LIMIT ? OFFSET ?";
    countQuery += whereClause;
    
    const [rows]: any = await pool.query(query, [...queryParams, limit, offset]);
    const [[countRow]]: any = await pool.query(countQuery, queryParams);
    const [[summary]]: any = await pool.query(`
      SELECT
        SUM(CASE WHEN b.status = 'active' AND b.is_deleted = FALSE AND COALESCE(b.health_status, 'active') = 'active' THEN 1 ELSE 0 END) as monetized_bots,
        SUM(CASE WHEN b.status IN ('paused', 'token_invalid', 'bot_deleted', 'unreachable') AND b.is_deleted = FALSE THEN 1 ELSE 0 END) as paused_bots,
        SUM(CASE WHEN b.status IN ('token_invalid', 'bot_deleted', 'unreachable') AND b.is_deleted = FALSE THEN 1 ELSE 0 END) as failed_bots,
        (SELECT COUNT(*) FROM bot_users) as total_bot_users,
        (SELECT COUNT(*)
         FROM bot_users bu
         JOIN bots active_bots ON active_bots.id = bu.bot_id
         WHERE active_bots.status = 'active'
           AND active_bots.is_deleted = FALSE
           AND COALESCE(active_bots.health_status, 'active') = 'active'
           AND bu.is_active = TRUE
           AND bu.status = 'active') as active_bot_users,
        (SELECT COUNT(*)
         FROM bot_users bu
         JOIN bots parent_bots ON parent_bots.id = bu.bot_id
         WHERE bu.is_active = FALSE
            OR bu.status != 'active'
            OR parent_bots.status != 'active'
            OR COALESCE(parent_bots.health_status, 'active') != 'active'
            OR parent_bots.is_deleted = TRUE) as inactive_bot_users
      FROM bots b
    `);

    return NextResponse.json({
      bots: rows,
      total: countRow.total,
      page,
      totalPages: Math.ceil(countRow.total / limit),
      summary: {
        monetized_bots: Number(summary?.monetized_bots || 0),
        paused_bots: Number(summary?.paused_bots || 0),
        failed_bots: Number(summary?.failed_bots || 0),
        total_bot_users: Number(summary?.total_bot_users || 0),
        active_bot_users: Number(summary?.active_bot_users || 0),
        inactive_bot_users: Number(summary?.inactive_bot_users || 0),
      },
    });
  } catch (error: any) {
    console.error("Admin Bots API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, action } = await request.json();
    const normalizedAction = action === "deny" ? "reject" : action === "approve" ? "activate" : action;

    // Fetch bot and owner details
    const [rows]: any = await pool.query(
      `SELECT b.bot_name, b.bot_username, b.bot_token, u.telegram_id 
       FROM bots b 
       JOIN users u ON b.user_id = u.id 
       WHERE b.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }

    const bot = rows[0];
    const statusMap: Record<string, string> = {
      activate: "active",
      pause: "paused",
      reject: "rejected",
      delete: "deleted",
    };

    if (!statusMap[normalizedAction]) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const status = statusMap[normalizedAction];

    if (normalizedAction === "activate") {
      await reactivateBotAfterHealthCheck(id, bot.bot_token);
    } else if (normalizedAction === "delete") {
      await pool.query(
        `UPDATE bots
         SET status = ?, is_deleted = TRUE, paused_reason = 'Bot removed by admin.', suggested_fix = 'Contact support if this was unexpected.', health_status = 'paused'
         WHERE id = ?`,
        [status, id]
      );
    } else if (normalizedAction === "pause") {
      await pool.query(
        `UPDATE bots
         SET status = ?, paused_reason = 'Paused by admin.', suggested_fix = 'Resolve the admin review item, then reactivate.', health_status = 'paused'
         WHERE id = ?`,
        [status, id]
      );
    } else {
      await pool.query("UPDATE bots SET status = ? WHERE id = ?", [status, id]);
    }

    // Send Telegram Notification
    const message = normalizedAction === "activate"
      ? `🤖 <b>Bot Approved!</b>\n\nYour bot <b>${bot.bot_name}</b> (@${bot.bot_username}) has been approved for monetization. You can now start serving ads.`
      : `❌ <b>Bot Rejected</b>\n\nUnfortunately, your bot <b>${bot.bot_name}</b> (@${bot.bot_username}) was not approved for monetization at this time.`;

    if (normalizedAction === "activate" || normalizedAction === "reject") {
      await sendTelegramMessage(bot.telegram_id, message);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Admin Bots Update Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
