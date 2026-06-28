import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";
import { sendTelegramMessage } from "@/lib/telegram";
import { ensureDefaultChannelDistribution } from "@/lib/channelLifecycle";

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
      SELECT c.*, u.first_name, u.last_name, u.username AS owner_username, u.telegram_id as owner_telegram_id
      FROM channels c
      LEFT JOIN users u ON c.user_id = u.id
    `;
    let countQuery = "SELECT COUNT(*) as total FROM channels c LEFT JOIN users u ON c.user_id = u.id";
    const queryParams: any[] = [];

    let whereClause = " WHERE c.is_deleted = FALSE";

    if (statusFilter !== "all") {
      whereClause += " AND c.status = ?";
      queryParams.push(statusFilter);
    }

    if (qualityFilter !== "all") {
      whereClause += " AND COALESCE(c.traffic_quality_tier, 'good') = ?";
      queryParams.push(qualityFilter);
    }

    if (riskFilter !== "all") {
      whereClause += " AND COALESCE(c.traffic_risk_level, 'low') = ?";
      queryParams.push(riskFilter);
    }

    if (search) {
      whereClause += ` AND (
        c.title LIKE ? OR 
        c.username LIKE ? OR 
        c.chat_id LIKE ? OR 
        c.user_id LIKE ? OR
        u.first_name LIKE ? OR 
        u.last_name LIKE ? OR 
        u.username LIKE ? OR 
        u.telegram_id LIKE ?
      )`;
      const searchVal = `%${search}%`;
      queryParams.push(searchVal, searchVal, searchVal, searchVal, searchVal, searchVal, searchVal, searchVal);
    }

    query += whereClause + " ORDER BY c.id DESC LIMIT ? OFFSET ?";
    countQuery += whereClause;

    const [rows]: any = await pool.query(query, [...queryParams, limit, offset]);
    const [[countRow]]: any = await pool.query(countQuery, queryParams);
    const [[summary]]: any = await pool.query(`
      SELECT
        SUM(CASE WHEN status = 'active' AND is_deleted = FALSE AND COALESCE(health_status, 'active') = 'active' THEN 1 ELSE 0 END) as active_channels,
        SUM(CASE WHEN status IN ('paused', 'bot_removed', 'channel_not_found', 'permission_missing') AND is_deleted = FALSE THEN 1 ELSE 0 END) as paused_channels,
        SUM(CASE WHEN status IN ('bot_removed', 'channel_not_found', 'permission_missing') AND is_deleted = FALSE THEN 1 ELSE 0 END) as failed_channels,
        SUM(CASE WHEN status = 'deleted' OR is_deleted = TRUE THEN 1 ELSE 0 END) as deleted_channels,
        SUM(CASE WHEN status = 'active' AND is_deleted = FALSE AND COALESCE(health_status, 'active') = 'active' THEN subscriber_count ELSE 0 END) as active_subscribers
      FROM channels
    `);

    return NextResponse.json({
      channels: rows,
      total: countRow.total,
      page,
      totalPages: Math.ceil(countRow.total / limit),
      summary,
    });
  } catch (error: any) {
    console.error("Admin Channels API Error:", error);
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

    // Fetch channel and owner details
    const [rows]: any = await pool.query(
      `SELECT c.title, c.username, u.telegram_id 
       FROM channels c 
       JOIN users u ON c.user_id = u.id 
       WHERE c.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const channel = rows[0];
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
      await pool.query(
        `UPDATE channels
         SET status = ?,
             is_deleted = FALSE,
             paused_reason = NULL,
             suggested_fix = NULL,
             failure_reason = NULL,
             health_status = 'active',
             health_checked_at = NOW(),
             reactivated_at = NOW()
         WHERE id = ?`,
        [status, id]
      );
      await ensureDefaultChannelDistribution();
    } else if (normalizedAction === "delete") {
      await pool.query("UPDATE channels SET status = ?, is_deleted = TRUE, paused_reason = 'Deleted by admin.', suggested_fix = NULL WHERE id = ?", [status, id]);
    } else {
      await pool.query("UPDATE channels SET status = ?, paused_reason = ?, suggested_fix = ? WHERE id = ?", [
        status,
        status === "paused" ? "Paused by admin." : null,
        status === "paused" ? "Contact support or reactivate after fixing channel access." : null,
        id,
      ]);
    }

    // Send Telegram Notification
    const message = normalizedAction === "activate"
      ? `✅ <b>Channel Approved!</b>\n\nYour channel <b>${channel.title}</b> (${channel.username ? `@${channel.username}` : "your private channel"}) has been approved and is now active in the advertisements network.`
      : `❌ <b>Channel Rejected</b>\n\nUnfortunately, your channel <b>${channel.title}</b> (${channel.username ? `@${channel.username}` : "your private channel"}) was not approved for monetization at this time.`;

    if (normalizedAction === "activate" || normalizedAction === "reject") {
      await sendTelegramMessage(channel.telegram_id, message);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Admin Channels Update Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
