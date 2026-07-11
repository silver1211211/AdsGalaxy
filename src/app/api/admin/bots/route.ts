import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { escapeTelegramHtml, sendTelegramMessage } from "@/lib/telegram";
import { reactivateBotAfterHealthCheck } from "@/lib/botLifecycle";
import type { RowDataPacket } from "mysql2/promise";
import { loadBotToken } from "@/lib/botIntegration";
import { botOperationalCondition, botUserBlockedCondition, botUserBroadcastEligibleCondition, botUserCountExpressions, botUserVerifiedReachableCondition } from "@/lib/botAudience";

type AdminBotRow = RowDataPacket & Record<string, unknown>;
type CountRow = RowDataPacket & { total: number };
type BotSummaryRow = RowDataPacket & {
  monetized_bots: number | string | null;
  delivery_eligible_bots: number | string | null;
  paused_bots: number | string | null;
  failed_bots: number | string | null;
  total_bot_users: number | string | null;
  active_bot_users: number | string | null;
  delivery_eligible_bot_users: number | string | null;
  inactive_bot_users: number | string | null;
};
type BotActionRow = RowDataPacket & {
  bot_name: string;
  bot_username: string;
  bot_token: string;
  bot_token_encrypted: string | null;
  telegram_id: string;
};

async function getTableColumns(tableName: string) {
  const [rows] = await pool.query<Array<RowDataPacket & { COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    [tableName]
  );

  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function tableExists(tableName: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     LIMIT 1`,
    [tableName]
  );

  return rows.length > 0;
}

function col(columns: Set<string>, name: string, fallback: string) {
  return columns.has(name) ? `b.${name}` : fallback;
}

function updateAssignable(columns: Set<string>, values: Record<string, unknown>) {
  const assignments: string[] = [];
  const params: unknown[] = [];

  Object.entries(values).forEach(([name, value]) => {
    if (columns.has(name)) {
      assignments.push(`${name} = ?`);
      params.push(value);
    }
  });

  return { assignments, params };
}

export async function GET(request: Request) {
  const { response } = await requireAdminPermission("read");
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "10") || 10));
  const statusFilter = searchParams.get("status") || "all";
  const qualityFilter = searchParams.get("quality") || "all";
  const riskFilter = searchParams.get("risk") || "all";
  const search = searchParams.get("search") || "";
  const offset = (page - 1) * limit;

  try {
    const [botColumns, botUserColumns, hasBotUsers] = await Promise.all([
      getTableColumns("bots"),
      getTableColumns("bot_users"),
      tableExists("bot_users"),
    ]);
    const isDeletedExpr = col(botColumns, "is_deleted", "FALSE");
    const healthStatusExpr = col(botColumns, "health_status", "'active'");
    const qualityScoreExpr = col(botColumns, "traffic_quality_score", "60");
    const qualityTierExpr = col(botColumns, "traffic_quality_tier", "'good'");
    const riskLevelExpr = col(botColumns, "traffic_risk_level", "'low'");
    void botUserColumns;
    const countExpr = botUserCountExpressions("b");
    const activeCountExpr = hasBotUsers ? countExpr.active : "0";
    const blockedCountExpr = hasBotUsers ? countExpr.blocked : "0";
    const botUsersSummary = hasBotUsers
      ? {
          total: "(SELECT COUNT(*) FROM bot_users)",
          active: `(SELECT COUNT(*)
         FROM bot_users bu
         JOIN bots active_bots ON active_bots.id = bu.bot_id
         WHERE ${botUserVerifiedReachableCondition("bu")})`,
          deliveryEligible: `(SELECT COUNT(*)
         FROM bot_users bu
         JOIN bots active_bots ON active_bots.id = bu.bot_id
         WHERE ${botUserBroadcastEligibleCondition("bu", "active_bots")})`,
          inactive: `(SELECT COUNT(*)
         FROM bot_users bu
         JOIN bots parent_bots ON parent_bots.id = bu.bot_id
         WHERE (${botUserBlockedCondition("bu")})
            OR parent_bots.status != 'active'
            OR ${botColumns.has("is_deleted") ? "parent_bots.is_deleted = TRUE" : "0=1"})`,
        }
      : { total: "0", active: "0", deliveryEligible: "0", inactive: "0" };

    let query = `
      SELECT
        b.id,
        b.user_id,
        ${col(botColumns, "bot_username", "NULL")} as bot_username,
        ${col(botColumns, "bot_name", "NULL")} as bot_name,
        ${col(botColumns, "posts_per_day", "1")} as posts_per_day,
        ${col(botColumns, "continents", "NULL")} as continents,
        ${col(botColumns, "categories", "NULL")} as categories,
        b.status,
        ${col(botColumns, "paused_reason", "NULL")} as paused_reason,
        ${col(botColumns, "suggested_fix", "NULL")} as suggested_fix,
        ${healthStatusExpr} as health_status,
        ${col(botColumns, "last_successful_broadcast_at", "NULL")} as last_successful_broadcast_at,
        ${col(botColumns, "last_failure_at", "NULL")} as last_failure_at,
        ${col(botColumns, "failure_reason", "NULL")} as failure_reason,
        COALESCE(${qualityScoreExpr}, 60) as traffic_quality_score,
        COALESCE(${qualityTierExpr}, 'good') as traffic_quality_tier,
        COALESCE(${riskLevelExpr}, 'low') as traffic_risk_level,
        ${col(botColumns, "traffic_quality_updated_at", "NULL")} as traffic_quality_updated_at,
        ${isDeletedExpr} as is_deleted,
        ${col(botColumns, "created_at", "NULL")} as created_at,
        ${col(botColumns, "updated_at", "NULL")} as updated_at,
        u.first_name,
        u.last_name,
        u.username AS owner_username,
        u.telegram_id as owner_telegram_id,
        CASE
          WHEN b.status = 'active'
            THEN ${activeCountExpr}
          ELSE 0
        END as active_count,
        ${blockedCountExpr} as blocked_count
      FROM bots b
      LEFT JOIN users u ON b.user_id = u.id
    `;
    let countQuery = "SELECT COUNT(*) as total FROM bots b LEFT JOIN users u ON b.user_id = u.id";
    const queryParams: unknown[] = [];

    let whereClause = ` WHERE ${isDeletedExpr} = FALSE`;
    
    if (statusFilter !== "all") {
      whereClause += " AND b.status = ?";
      queryParams.push(statusFilter);
    }

    if (qualityFilter !== "all" && botColumns.has("traffic_quality_tier")) {
      whereClause += " AND COALESCE(b.traffic_quality_tier, 'good') = ?";
      queryParams.push(qualityFilter);
    }

    if (riskFilter !== "all" && botColumns.has("traffic_risk_level")) {
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
    
    const [rows] = await pool.query<AdminBotRow[]>(query, [...queryParams, limit, offset]);
    const [countRows] = await pool.query<CountRow[]>(countQuery, queryParams);
    const [summaryRows] = await pool.query<BotSummaryRow[]>(`
      SELECT
        SUM(CASE WHEN b.status = 'active' AND ${isDeletedExpr} = FALSE THEN 1 ELSE 0 END) as monetized_bots,
        SUM(CASE WHEN ${botOperationalCondition("b")} THEN 1 ELSE 0 END) as delivery_eligible_bots,
        SUM(CASE WHEN b.status IN ('paused', 'token_invalid', 'bot_deleted', 'unreachable') AND ${isDeletedExpr} = FALSE THEN 1 ELSE 0 END) as paused_bots,
        SUM(CASE WHEN b.status IN ('token_invalid', 'bot_deleted', 'unreachable') AND ${isDeletedExpr} = FALSE THEN 1 ELSE 0 END) as failed_bots,
        ${botUsersSummary.total} as total_bot_users,
        ${botUsersSummary.active} as active_bot_users,
        ${botUsersSummary.deliveryEligible} as delivery_eligible_bot_users,
        ${botUsersSummary.inactive} as inactive_bot_users
      FROM bots b
    `);

    const countRow = countRows[0];
    const summary = summaryRows[0];
    return NextResponse.json({
      bots: rows,
      total: countRow.total,
      page,
      totalPages: Math.ceil(countRow.total / limit),
      summary: {
        monetized_bots: Number(summary?.monetized_bots || 0),
        delivery_eligible_bots: Number(summary?.delivery_eligible_bots || 0),
        paused_bots: Number(summary?.paused_bots || 0),
        failed_bots: Number(summary?.failed_bots || 0),
        total_bot_users: Number(summary?.total_bot_users || 0),
        active_bot_users: Number(summary?.active_bot_users || 0),
        delivery_eligible_bot_users: Number(summary?.delivery_eligible_bot_users || 0),
        inactive_bot_users: Number(summary?.inactive_bot_users || 0),
      },
    });
  } catch (error: unknown) {
    console.error("Admin Bots API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const { id, action } = await request.json();
    const normalizedAction = action === "deny" ? "reject" : action === "approve" ? "activate" : action;

    // Fetch bot and owner details
    const [rows] = await pool.query<BotActionRow[]>(
      `SELECT b.bot_name, b.bot_username, b.bot_token, b.bot_token_encrypted, u.telegram_id
       FROM bots b 
       JOIN users u ON b.user_id = u.id 
       WHERE b.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }

    const bot = rows[0];
    const botColumns = await getTableColumns("bots");
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
      await reactivateBotAfterHealthCheck(id, await loadBotToken(pool, { ...bot, id }), pool, new URL(request.url).origin);
    } else if (normalizedAction === "delete") {
      const { assignments, params } = updateAssignable(botColumns, {
        status,
        is_deleted: true,
        paused_reason: "Bot removed by admin.",
        suggested_fix: "Contact support if this was unexpected.",
        health_status: "paused",
      });
      if (assignments.length > 0) {
        await pool.query(`UPDATE bots SET ${assignments.join(", ")} WHERE id = ?`, [...params, id]);
      }
    } else if (normalizedAction === "pause") {
      const { assignments, params } = updateAssignable(botColumns, {
        status,
        paused_reason: "Paused by admin.",
        suggested_fix: "Resolve the admin review item, then reactivate.",
        health_status: "paused",
      });
      if (assignments.length > 0) {
        await pool.query(`UPDATE bots SET ${assignments.join(", ")} WHERE id = ?`, [...params, id]);
      }
    } else {
      await pool.query("UPDATE bots SET status = ? WHERE id = ?", [status, id]);
    }

    // Send Telegram Notification
    const message = normalizedAction === "activate"
      ? `🤖 <b>Bot Approved!</b>\n\nYour bot <b>${escapeTelegramHtml(bot.bot_name)}</b> (@${escapeTelegramHtml(bot.bot_username)}) has been approved for monetization. You can now start serving ads.`
      : `❌ <b>Bot Rejected</b>\n\nUnfortunately, your bot <b>${escapeTelegramHtml(bot.bot_name)}</b> (@${escapeTelegramHtml(bot.bot_username)}) was not approved for monetization at this time.`;

    if (normalizedAction === "activate" || normalizedAction === "reject") {
      await sendTelegramMessage(bot.telegram_id, message, { parse_mode: "HTML" });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Admin Bots Update Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
