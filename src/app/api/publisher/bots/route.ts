import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { requireUserWritesAllowed } from "@/lib/productionSafety";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { botTokenHash, encryptBotToken, ensureBotIntegration, isBotEncryptionError, publisherBotEncryptionErrorMessage, resolveBotIntegrationStatus } from "@/lib/botIntegration";
import { notifyBotSubmitted } from "@/lib/publisherNotifications";

type ExistingBotRow = RowDataPacket & { id: number; user_id: number; is_deleted: boolean | number };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
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

async function columnExists(tableName: string, columnName: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );

  return rows.length > 0;
}

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const [hasBroadcastDeliveries, hasWebhookTimestamp, hasBroadcastPublisherReward, hasBotUserSource, hasIntegrationFirstSeen] = await Promise.all([
      tableExists("broadcast_deliveries"),
      columnExists("bots", "webhook_last_update_at"),
      columnExists("broadcast_deliveries", "publisher_reward"),
      columnExists("bot_users", "source"),
      columnExists("bot_users", "integration_first_seen_at"),
    ]);
    const botImpressionsExpr = hasBroadcastDeliveries
      ? "COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.bot_id = b.id), 0)"
      : "0";
    const botRevenueExpr = hasBroadcastDeliveries && hasBroadcastPublisherReward
      ? "COALESCE((SELECT SUM(bd.publisher_reward) FROM broadcast_deliveries bd WHERE bd.bot_id = b.id), 0)"
      : "0";
    const webhookTimestampExpr = hasWebhookTimestamp
      ? "b.webhook_last_update_at,"
      : "NULL as webhook_last_update_at,";
    const integrationUserCountExpr = hasBotUserSource
      ? "(SELECT COUNT(*) FROM bot_users WHERE bot_id = b.id AND source = 'integration')"
      : hasIntegrationFirstSeen
        ? "(SELECT COUNT(*) FROM bot_users WHERE bot_id = b.id AND integration_first_seen_at IS NOT NULL)"
        : "0";
    const manuallyImportedCountExpr = hasBotUserSource
      ? "(SELECT COUNT(*) FROM bot_users WHERE bot_id = b.id AND source <> 'integration')"
      : hasIntegrationFirstSeen
        ? "(SELECT COUNT(*) FROM bot_users WHERE bot_id = b.id AND integration_first_seen_at IS NULL)"
        : "(SELECT COUNT(*) FROM bot_users WHERE bot_id = b.id)";

    const [rows] = await pool.query(
      `SELECT
        b.id,
        b.created_at,
        b.bot_name,
        b.bot_username,
        b.status,
        b.integration_installed_at,
        b.integration_last_received_at,
        b.integration_last_error_at,
        b.paused_reason,
        b.suggested_fix,
        b.health_status,
        b.health_checked_at,
        b.last_successful_broadcast_at,
        b.last_failure_at,
        b.failure_reason,
        ${webhookTimestampExpr}
        b.posts_per_day,
        b.categories,
        b.continents,
        b.marketplace_visible,
        (SELECT COUNT(*) FROM bot_users WHERE bot_id = b.id) as subscriber_count,
        CASE
          WHEN b.status = 'active' AND COALESCE(b.health_status, 'active') = 'active'
            THEN (SELECT COUNT(*) FROM bot_users WHERE bot_id = b.id AND is_active = TRUE AND status = 'active')
          ELSE 0
        END as active_count,
        (SELECT COUNT(*) FROM bot_users WHERE bot_id = b.id AND (is_active = FALSE OR status IN ('inactive','blocked_bot','user_not_found','chat_not_found','unreachable'))) as blocked_count,
        (SELECT COUNT(*) FROM bot_users WHERE bot_id = b.id AND status = 'pending_verification') as pending_verification_count,
        ${integrationUserCountExpr} as integration_user_count,
        ${manuallyImportedCountExpr} as manually_imported_count,
        ${botImpressionsExpr} as total_impressions,
        ${botRevenueExpr} as total_revenue
       FROM bots b 
       WHERE b.user_id = ? AND b.is_deleted = FALSE 
       ORDER BY b.created_at DESC`, 
      [user.id]
    );
    return NextResponse.json((rows as Array<Record<string, unknown>>).map((row) => ({
      ...row,
      integration_status: resolveBotIntegrationStatus({
        botStatus: row.status,
        registrationCount: row.active_count,
        pendingVerificationCount: row.pending_verification_count,
        installedAt: row.integration_installed_at,
        lastReceivedAt: row.integration_last_received_at,
        lastErrorAt: row.integration_last_error_at,
      }),
    })));
  } catch (error: unknown) {
    console.error("API Error:", error);
    return NextResponse.json({ error: errorMessage(error, "Failed to fetch bots") }, { status: getAuthErrorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    const blocked = await requireUserWritesAllowed();
    if (blocked) return blocked;

    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    const body = await request.json();
    const { bot_token, posts_per_day, continents, categories } = body;

    if (!bot_token) {
      return NextResponse.json({ error: "Bot token is required" }, { status: 400 });
    }

    // 1. Validate bot token with Telegram
    const normalizedToken = String(bot_token).trim();
    if (!/^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(normalizedToken)) {
      return NextResponse.json({ error: "Bot token format is invalid" }, { status: 400 });
    }
    const tgRes = await fetch(`https://api.telegram.org/bot${normalizedToken}/getMe`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    const tgData = await tgRes.json();

    if (!tgData.ok) {
      return NextResponse.json({ error: "Invalid bot token or Telegram API error" }, { status: 400 });
    }

    const { username: bot_username, first_name: bot_name } = tgData.result;

    // 2. Check if bot already exists
    const [existing] = await pool.query<ExistingBotRow[]>(
      "SELECT id, user_id, is_deleted FROM bots WHERE bot_token_hash = ? OR bot_token = ?",
      [botTokenHash(normalizedToken), normalizedToken]
    );

    if (existing.length > 0) {
      const bot = existing[0];
      
      if (bot.user_id !== user.id) {
        return NextResponse.json({ error: "This bot is already registered by another user" }, { status: 400 });
      }

      if (!bot.is_deleted) {
        return NextResponse.json({ error: "This bot is already active in your dashboard." }, { status: 400 });
      }

      // Reactivate soft-deleted bot
      await pool.query(
        `UPDATE bots SET 
          bot_username = ?,
          bot_name = ?, 
          bot_token = ?, bot_token_encrypted = ?, bot_token_hash = ?,
          posts_per_day = ?, 
          continents = ?, 
          categories = ?,
          is_deleted = FALSE,
          status = 'pending',
          paused_reason = NULL,
          suggested_fix = NULL,
          health_status = NULL,
          failure_reason = NULL,
          reactivated_at = NOW()
         WHERE id = ?`,
        [bot_username, bot_name, `secure:${botTokenHash(normalizedToken)}`, encryptBotToken(normalizedToken), botTokenHash(normalizedToken), posts_per_day, JSON.stringify(continents), JSON.stringify(categories || []), bot.id]
      );

      const integrationUrl = await ensureBotIntegration(pool, new URL(request.url).origin, bot.id);
      await notifyBotSubmitted(user.telegram_id, bot.id, bot_username);
      return NextResponse.json({ success: true, id: bot.id, bot_id: bot.id, integration_url: integrationUrl, message: "Bot reactivated and updated" });
    }

    // 3. Insert new bot
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO bots (user_id, bot_token, bot_token_encrypted, bot_token_hash, bot_username, bot_name, posts_per_day, continents, categories, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [user.id, `secure:${botTokenHash(normalizedToken)}`, encryptBotToken(normalizedToken), botTokenHash(normalizedToken), bot_username, bot_name, posts_per_day, JSON.stringify(continents), JSON.stringify(categories || [])]
    );

    const integrationUrl = await ensureBotIntegration(pool, new URL(request.url).origin, result.insertId);
    await notifyBotSubmitted(user.telegram_id, result.insertId, bot_username);
    return NextResponse.json({ success: true, id: result.insertId, bot_id: result.insertId, integration_url: integrationUrl }, { status: 201 });
  } catch (error: unknown) {
    console.error("API Error:", error);
    if (isBotEncryptionError(error)) {
      console.error("Publisher bot encryption/configuration failure", { code: error.code });
      return NextResponse.json({ error: publisherBotEncryptionErrorMessage() }, { status: 503 });
    }
    return NextResponse.json({ error: errorMessage(error, "Failed to add bot") }, { status: getAuthErrorStatus(error) });
  }
}
