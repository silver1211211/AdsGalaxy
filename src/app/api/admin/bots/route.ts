import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";
import { sendTelegramMessage } from "@/lib/telegram";

export async function GET(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "10");
  const statusFilter = searchParams.get("status") || "all";
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
        b.is_deleted,
        b.created_at,
        b.updated_at,
        u.first_name,
        u.last_name,
        u.username AS owner_username,
        u.telegram_id as owner_telegram_id,
        (SELECT COUNT(*) FROM bot_users WHERE bot_id = b.id AND is_active = TRUE) as active_count,
        (SELECT COUNT(*) FROM bot_users WHERE bot_id = b.id AND is_active = FALSE) as blocked_count
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

    return NextResponse.json({
      bots: rows,
      total: countRow.total,
      page,
      totalPages: Math.ceil(countRow.total / limit),
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
    const normalizedAction = action === "deny" ? "reject" : action;

    // Fetch bot and owner details
    const [rows]: any = await pool.query(
      `SELECT b.bot_name, b.bot_username, u.telegram_id 
       FROM bots b 
       JOIN users u ON b.user_id = u.id 
       WHERE b.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }

    const bot = rows[0];
    const status = normalizedAction === "approve" ? "active" : "rejected";
    
    await pool.query("UPDATE bots SET status = ? WHERE id = ?", [status, id]);

    // Send Telegram Notification
    const message = normalizedAction === "approve" 
      ? `🤖 <b>Bot Approved!</b>\n\nYour bot <b>${bot.bot_name}</b> (@${bot.bot_username}) has been approved for monetization. You can now start serving ads.`
      : `❌ <b>Bot Rejected</b>\n\nUnfortunately, your bot <b>${bot.bot_name}</b> (@${bot.bot_username}) was not approved for monetization at this time.`;

    await sendTelegramMessage(bot.telegram_id, message);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Admin Bots Update Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
