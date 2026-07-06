import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { reactivateBotAfterHealthCheck } from "@/lib/botLifecycle";
import { ensureBotIntegration, isBotEncryptionError, loadBotToken, publisherBotEncryptionErrorMessage, regenerateBotIntegration, resolveBotIntegrationStatus } from "@/lib/botIntegration";
import { notifyBotRemoved } from "@/lib/publisherNotifications";
import { botUserCountExpressions } from "@/lib/botAudience";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

export const dynamic = "force-dynamic";

type PublisherBotDetailsRow = RowDataPacket & {
  id: number;
  bot_name: string;
  bot_username: string | null;
  bot_token: string;
  bot_token_encrypted: string | null;
  status: string;
  created_at: string;
  integration_installed_at: string | null;
  integration_last_received_at: string | null;
  integration_last_user_id: string | null;
  integration_last_error_at: string | null;
  integration_last_error: string | null;
  subscriber_count: number;
  active_count: number;
  integration_user_count: number;
  manually_imported_count: number;
  pending_verification_count: number;
  blocked_count: number;
  delivery_eligible_count: number;
  successful_sends: number;
  failed_sends: number;
  publisher_revenue: number;
  effective_cpm: number;
};

type BotStatusRow = RowDataPacket & { status: string; bot_token: string; bot_token_encrypted: string | null };

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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const { id } = await params;
    const [hasBotUserSource, hasIntegrationFirstSeen, hasBroadcastDeliveries, hasBroadcastPublisherReward] = await Promise.all([
      columnExists("bot_users", "source"),
      columnExists("bot_users", "integration_first_seen_at"),
      tableExists("broadcast_deliveries"),
      columnExists("broadcast_deliveries", "publisher_reward"),
    ]);
    const integrationUserCountExpr = hasIntegrationFirstSeen
      ? "(SELECT COUNT(*) FROM bot_users bu WHERE bu.bot_id = b.id AND bu.integration_first_seen_at IS NOT NULL)"
      : hasBotUserSource
        ? "(SELECT COUNT(*) FROM bot_users bu WHERE bu.bot_id = b.id AND bu.source = 'integration')"
        : "0";
    const manuallyImportedCountExpr = hasBotUserSource
      ? "(SELECT COUNT(*) FROM bot_users bu WHERE bu.bot_id = b.id AND bu.source <> 'integration')"
      : hasIntegrationFirstSeen
        ? "(SELECT COUNT(*) FROM bot_users bu WHERE bu.bot_id = b.id AND bu.integration_first_seen_at IS NULL)"
        : "(SELECT COUNT(*) FROM bot_users bu WHERE bu.bot_id = b.id)";
    const userCounts = botUserCountExpressions("b");
    const botSuccessfulExpr = hasBroadcastDeliveries
      ? "COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.bot_id = b.id AND bd.status = 'sent'), 0)"
      : "0";
    const botFailedExpr = hasBroadcastDeliveries
      ? "COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.bot_id = b.id AND bd.status = 'failed'), 0)"
      : "0";
    const botRevenueExpr = hasBroadcastDeliveries && hasBroadcastPublisherReward
      ? "COALESCE((SELECT SUM(bd.publisher_reward) FROM broadcast_deliveries bd WHERE bd.bot_id = b.id AND bd.status = 'sent'), 0)"
      : "0";
    const [rows] = await pool.query<PublisherBotDetailsRow[]>(
      `SELECT
        b.id,
        b.bot_name,
        b.bot_username,
        b.bot_token,
        b.bot_token_encrypted,
        b.status,
        b.created_at,
        b.integration_installed_at,
        b.integration_last_received_at,
        b.integration_last_user_id,
        b.integration_last_error_at,
        b.integration_last_error,
        ${userCounts.total} as subscriber_count,
        ${userCounts.active} as active_count
        ,${integrationUserCountExpr} as integration_user_count
        ,${manuallyImportedCountExpr} as manually_imported_count
        ,${userCounts.pending} as pending_verification_count
        ,${userCounts.blocked} as blocked_count
        ,${userCounts.deliveryEligible} as delivery_eligible_count
        ,${botSuccessfulExpr} as successful_sends
        ,${botSuccessfulExpr} as successful_paid_deliveries
        ,${botSuccessfulExpr} as delivered_sends
        ,${botFailedExpr} as failed_sends
        ,${botRevenueExpr} as publisher_revenue
        ,CASE WHEN ${botSuccessfulExpr} > 0 THEN (${botRevenueExpr} / ${botSuccessfulExpr}) * 1000 ELSE 0 END as effective_cpm
       FROM bots b
       WHERE b.id = ? AND b.user_id = ? AND b.is_deleted = FALSE
       LIMIT 1`,
      [id, user.id]
    );
    const bot = rows[0];
    if (!bot) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }

    const integrationUrl = await ensureBotIntegration(pool, new URL(request.url).origin, bot.id);
    const integrationStatus = resolveBotIntegrationStatus({ botStatus: bot.status, registrationCount: bot.active_count, pendingVerificationCount: bot.pending_verification_count,
      installedAt: bot.integration_installed_at, lastReceivedAt: bot.integration_last_received_at, lastErrorAt: bot.integration_last_error_at });
    const [eventRows] = await pool.query<RowDataPacket[]>(
      `SELECT event_type, telegram_user_id, username, message,
         CASE WHEN event_type = 'error' THEN message ELSE NULL END AS error,
         CASE WHEN event_type IN ('user', 'duplicate', 'test') THEN 'success' ELSE event_type END AS result,
         received_at
       FROM bot_integration_events WHERE bot_id = ? ORDER BY id DESC LIMIT 10`,
      [bot.id]
    );

    return NextResponse.json({
      id: bot.id,
      bot_name: bot.bot_name,
      bot_username: bot.bot_username,
      status: bot.status,
      approval_state: bot.status,
      created_at: bot.created_at,
      subscriber_count: Number(bot.subscriber_count || 0),
      active_count: Number(bot.active_count || 0),
      integration_user_count: Number(bot.integration_user_count || 0),
      manually_imported_count: Number(bot.manually_imported_count || 0),
      verified_reachable_count: Number(bot.active_count || 0),
      verified_count: Number(bot.active_count || 0),
      reachable_count: Number(bot.active_count || 0),
      blocked_unreachable_count: Number(bot.blocked_count || 0),
      pending_verification_count: Number(bot.pending_verification_count || 0),
      delivery_eligible_count: Number(bot.delivery_eligible_count || 0),
      successful_sends: Number(bot.successful_sends || 0),
      successful_paid_deliveries: Number(bot.successful_sends || 0),
      delivered_sends: Number(bot.successful_sends || 0),
      failed_sends: Number(bot.failed_sends || 0),
      publisher_revenue: Number(bot.publisher_revenue || 0),
      total_revenue: Number(bot.publisher_revenue || 0),
      effective_cpm: Number(bot.effective_cpm || 0),
      integration_url: integrationUrl,
      integration_secret_masked: `••••••••••••${integrationUrl.slice(-6)}`,
      integration_status: integrationStatus,
      integration_installed_at: bot.integration_installed_at,
      integration_last_received_at: bot.integration_last_received_at,
      integration_last_user_id: bot.integration_last_user_id,
      integration_last_error_at: bot.integration_last_error_at,
      integration_last_error: bot.integration_last_error,
      integration_events: eventRows,
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error: unknown) {
    if (isBotEncryptionError(error)) {
      console.error("GET Bot Details encryption/configuration failure", { code: error.code });
      return NextResponse.json({ error: publisherBotEncryptionErrorMessage() }, { status: 503 });
    }
    console.error("GET Bot Details Error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch bot details" },
      { status: getAuthErrorStatus(error) }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const { posts_per_day, continents, categories, action } = body;

    if (action === "regenerate_integration_secret") {
      const [ownedBots] = await pool.query<RowDataPacket[]>(
        "SELECT id FROM bots WHERE id = ? AND user_id = ? AND is_deleted = FALSE LIMIT 1",
        [id, user.id]
      );
      if (!ownedBots[0]) return NextResponse.json({ error: "Bot not found" }, { status: 404 });
      const integrationUrl = await regenerateBotIntegration(pool, new URL(request.url).origin, id);
      return NextResponse.json({ success: true, integration_url: integrationUrl });
    }

    if (action === "set_marketplace_visibility") {
      const visible = body.visible ? 1 : 0;
      const [result] = await pool.query<ResultSetHeader>(
        "UPDATE bots SET marketplace_visible = ? WHERE id = ? AND user_id = ? AND is_deleted = FALSE",
        [visible, id, user.id]
      );
      if (result.affectedRows === 0) {
        return NextResponse.json({ error: "Bot not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, marketplace_visible: visible });
    }

    // Handle status toggle
    if (action === "toggle_status") {
      const [rows] = await pool.query<BotStatusRow[]>(
        "SELECT status, bot_token, bot_token_encrypted FROM bots WHERE id = ? AND user_id = ? AND is_deleted = FALSE",
        [id, user.id]
      );

      if (rows.length === 0) {
        return NextResponse.json({ error: "Bot not found" }, { status: 404 });
      }

      const currentStatus = rows[0].status;
      if (currentStatus === "pending") {
        return NextResponse.json({ error: "Cannot pause a pending bot" }, { status: 400 });
      }

      const newStatus = currentStatus === "active" ? "paused" : "active";
      if (newStatus === "active") {
        const activation = await reactivateBotAfterHealthCheck(
          id,
          await loadBotToken(pool, { ...rows[0], id }),
          pool,
          new URL(request.url).origin
        );
        return NextResponse.json({ success: true, status: "active", integration_url: activation.integrationUrl });
      }

      await pool.query(
        `UPDATE bots
         SET status = ?,
             paused_reason = 'Paused by publisher.',
             suggested_fix = 'Reactivate the bot when you want AdsGalaxy to resume delivery.',
             health_status = 'paused'
         WHERE id = ? AND user_id = ?`,
        [newStatus, id, user.id]
      );
      return NextResponse.json({ success: true, status: newStatus });
    }

    // Handle general update
    if (posts_per_day !== undefined || continents !== undefined || categories !== undefined) {
      await pool.query(
        `UPDATE bots SET 
          posts_per_day = ?, 
          continents = ?,
          categories = ?
         WHERE id = ? AND user_id = ?`,
        [posts_per_day, JSON.stringify(continents), JSON.stringify(categories || []), id, user.id]
      );
      return NextResponse.json({ success: true, message: "Bot updated successfully" });
    }

    return NextResponse.json({ error: "No update fields provided" }, { status: 400 });
  } catch (error: unknown) {
    if (isBotEncryptionError(error)) {
      console.error("PATCH Bot encryption/configuration failure", { code: error.code });
      return NextResponse.json({ error: publisherBotEncryptionErrorMessage() }, { status: 503 });
    }
    console.error("PATCH Bot Error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update bot" }, { status: getAuthErrorStatus(error) });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const { id } = await params;

    const [botRows] = await pool.query<RowDataPacket[]>(
      "SELECT bot_username FROM bots WHERE id = ? AND user_id = ?",
      [id, user.id]
    );

    await pool.query(
      `UPDATE bots
       SET is_deleted = TRUE,
           status = 'deleted',
           paused_reason = 'Bot removed by publisher.',
           suggested_fix = 'Add the bot again if you want to monetize it later.',
           health_status = 'paused'
       WHERE id = ? AND user_id = ?`,
      [id, user.id]
    );

    if (botRows[0]?.bot_username) {
      await notifyBotRemoved(user.telegram_id, id, botRows[0].bot_username);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("DELETE Bot Error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete bot" }, { status: getAuthErrorStatus(error) });
  }
}
