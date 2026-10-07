import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import pool from "@/lib/db";
import { getAuthenticatedUserStatus, getAuthErrorStatus } from "@/lib/auth";
import { requireUserWritesAllowed } from "@/lib/productionSafety";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { botTokenHash, encryptBotToken, ensureBotIntegration, isBotEncryptionError, publisherBotEncryptionErrorMessage, resolveBotIntegrationStatus } from "@/lib/botIntegration";
import { notifyBotSubmitted } from "@/lib/publisherNotifications";
import { botUserCountExpressions } from "@/lib/botAudience";
import { safeQueuePublisherWelcome } from "@/lib/supportMessages";
import { authenticatePublisherAsset, PublisherAssetError, publisherAssetErrorResponse, publisherAssetTelemetry } from "@/lib/publisherAssetOnboarding";
import { verifyPublisherBotToken } from "@/lib/publisherBotToken";

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
    const user = await getAuthenticatedUserStatus(initData, { request });
    const [hasBroadcastDeliveries, hasWebhookTimestamp, hasBroadcastPublisherReward, hasBotUserSource, hasIntegrationFirstSeen] = await Promise.all([
      tableExists("broadcast_deliveries"),
      columnExists("bots", "webhook_last_update_at"),
      columnExists("broadcast_deliveries", "publisher_reward"),
      columnExists("bot_users", "source"),
      columnExists("bot_users", "integration_first_seen_at"),
    ]);
    const botImpressionsExpr = hasBroadcastDeliveries
      ? "COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.bot_id = b.id AND bd.status = 'sent'), 0)"
      : "0";
    const botDeliveredExpr = hasBroadcastDeliveries
      ? "COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.bot_id = b.id AND bd.status = 'sent'), 0)"
      : "0";
    const botFailedExpr = hasBroadcastDeliveries
      ? "COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.bot_id = b.id AND bd.status = 'failed'), 0)"
      : "0";
    const botRevenueExpr = hasBroadcastDeliveries && hasBroadcastPublisherReward
      ? "COALESCE((SELECT SUM(bd.publisher_reward) FROM broadcast_deliveries bd WHERE bd.bot_id = b.id AND bd.status = 'sent'), 0)"
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

    const userCounts = botUserCountExpressions("b", { publisherVisible: true });
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
        ${userCounts.total} as subscriber_count,
        ${userCounts.active} as active_count,
        ${userCounts.blocked} as blocked_count,
        ${userCounts.pending} as pending_verification_count,
        ${userCounts.verified} as verified_count,
        ${userCounts.reachable} as reachable_count,
        ${userCounts.deliveryEligible} as delivery_eligible_count,
        ${integrationUserCountExpr} as integration_user_count,
        ${manuallyImportedCountExpr} as manually_imported_count,
        ${botImpressionsExpr} as total_impressions,
        ${botDeliveredExpr} as successful_sends,
        ${botDeliveredExpr} as successful_paid_deliveries,
        ${botDeliveredExpr} as delivered_sends,
        ${botFailedExpr} as failed_sends,
        ${botRevenueExpr} as total_revenue,
        ${botRevenueExpr} as publisher_revenue,
        CASE WHEN ${botImpressionsExpr} > 0 THEN (${botRevenueExpr} / ${botImpressionsExpr}) * 1000 ELSE 0 END as effective_cpm
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
  const requestId = randomUUID(); let publisherId: number | undefined;
  publisherAssetTelemetry("bot_onboarding", { requestId, stage: "attempt", result: "started" });
  try {
    const blocked = await requireUserWritesAllowed();
    if (blocked) return blocked;

    const user = await authenticatePublisherAsset(request);
    publisherId = Number(user.id);
    publisherAssetTelemetry("bot_onboarding", { requestId, publisherId, stage: "auth", result: "success" });

    const body = await request.json();
    const { bot_token, posts_per_day, continents, categories } = body;

    if (!bot_token) {
      return NextResponse.json({ error: "Bot token is required" }, { status: 400 });
    }

    const normalizedToken = String(bot_token).trim();
    const verifiedBot = await verifyPublisherBotToken(normalizedToken);
    const { username: bot_username, name: bot_name } = verifiedBot;
    publisherAssetTelemetry("bot_onboarding", { requestId, publisherId, stage: "telegram_identity", result: "success", botUsername: bot_username, telegramBotId: verifiedBot.id });

    // 2. Check if bot already exists
    const connection = await pool.getConnection();
    let botId: number; let integrationUrl: string; let idempotent = false;
    try {
      await connection.beginTransaction();
      const [existing] = await connection.query<ExistingBotRow[]>("SELECT id,user_id,is_deleted FROM bots WHERE bot_token_hash = ? OR bot_token = ? FOR UPDATE", [botTokenHash(normalizedToken), normalizedToken]);

    if (existing.length > 0) {
      const bot = existing[0];
      
      if (Number(bot.user_id) !== Number(user.id)) throw new PublisherAssetError("BOT_OWNED_BY_ANOTHER_PUBLISHER", "This bot is already registered by another user.", 409);

      if (!bot.is_deleted) {
        botId = bot.id; idempotent = true;
        integrationUrl = await ensureBotIntegration(connection, new URL(request.url).origin, bot.id);
      } else {
        // Reactivate soft-deleted bot.
        await connection.query(
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
        botId = bot.id;
        integrationUrl = await ensureBotIntegration(connection, new URL(request.url).origin, bot.id);
      }
    } else {
      const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO bots (user_id, bot_token, bot_token_encrypted, bot_token_hash, bot_username, bot_name, posts_per_day, continents, categories, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [user.id, `secure:${botTokenHash(normalizedToken)}`, encryptBotToken(normalizedToken), botTokenHash(normalizedToken), bot_username, bot_name, posts_per_day, JSON.stringify(continents), JSON.stringify(categories || [])]
      );
      botId = result.insertId;
      integrationUrl = await ensureBotIntegration(connection, new URL(request.url).origin, result.insertId);
    }
    await connection.commit();
    } catch (error) { await connection.rollback().catch(() => undefined); throw error; } finally { connection.release(); }
    publisherAssetTelemetry("bot_onboarding", { requestId, publisherId, stage: "persist", result: idempotent ? "idempotent_success" : "success", botUsername: bot_username, telegramBotId: verifiedBot.id });
    if (!idempotent) after(async () => { try { await notifyBotSubmitted(String(user.telegram_id), botId, bot_username); } catch {} try { await safeQueuePublisherWelcome(user.id); } catch {} });
    const response = NextResponse.json({ success: true, id: botId, bot_id: botId, integration_url: integrationUrl, already_registered: idempotent }, { status: idempotent ? 200 : 201 });
    response.headers.set("X-Request-Id", requestId); return response;
  } catch (error: unknown) {
    const code = error instanceof PublisherAssetError ? error.code : "BOT_CREATE_FAILED";
    publisherAssetTelemetry("bot_onboarding", { requestId, publisherId, stage: "response", result: "failed", code });
    if (error instanceof PublisherAssetError) return publisherAssetErrorResponse(error);
    if (isBotEncryptionError(error)) {
      console.error("Publisher bot encryption/configuration failure", { code: error.code });
      return NextResponse.json({ error: publisherBotEncryptionErrorMessage() }, { status: 503 });
    }
    return NextResponse.json({ error: errorMessage(error, "Failed to add bot") }, { status: getAuthErrorStatus(error) });
  }
}
