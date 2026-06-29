import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { reactivateBotAfterHealthCheck } from "@/lib/botLifecycle";
import { createBotWebhookUrl } from "@/lib/botWebhook";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

type PublisherBotDetailsRow = RowDataPacket & {
  id: number;
  bot_name: string;
  bot_username: string | null;
  bot_token: string;
  status: string;
  created_at: string;
  webhook_last_update_at: string | null;
  subscriber_count: number;
  active_count: number;
};

type BotStatusRow = RowDataPacket & { status: string; bot_token: string };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const { id } = await params;
    const [rows] = await pool.query<PublisherBotDetailsRow[]>(
      `SELECT
        b.id,
        b.bot_name,
        b.bot_username,
        b.bot_token,
        b.status,
        b.created_at,
        b.webhook_last_update_at,
        (SELECT COUNT(*) FROM bot_users bu WHERE bu.bot_id = b.id) as subscriber_count,
        (SELECT COUNT(*) FROM bot_users bu WHERE bu.bot_id = b.id AND bu.is_active = TRUE AND bu.status = 'active') as active_count
       FROM bots b
       WHERE b.id = ? AND b.user_id = ? AND b.is_deleted = FALSE
       LIMIT 1`,
      [id, user.id]
    );
    const bot = rows[0];
    if (!bot) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }

    const webhookUrl = createBotWebhookUrl(new URL(request.url).origin, bot.id, bot.bot_token);
    let webhookConfigured = false;
    if (webhookUrl) {
      try {
        const response = await fetch(`https://api.telegram.org/bot${bot.bot_token}/getWebhookInfo`, {
          signal: AbortSignal.timeout(5000),
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        webhookConfigured = Boolean(data.ok && String(data.result?.url || "").replace(/\/$/, "") === webhookUrl.replace(/\/$/, ""));
      } catch {
        webhookConfigured = false;
      }
    }

    const webhookStatus = webhookConfigured
      ? (bot.webhook_last_update_at ? "receiving_users" : "configured")
      : "not_configured";

    return NextResponse.json({
      id: bot.id,
      bot_name: bot.bot_name,
      bot_username: bot.bot_username,
      status: bot.status,
      approval_state: bot.status,
      created_at: bot.created_at,
      subscriber_count: Number(bot.subscriber_count || 0),
      active_count: Number(bot.active_count || 0),
      webhook_url: webhookUrl,
      webhook_configured: webhookConfigured,
      webhook_status: webhookStatus,
      webhook_last_update_at: bot.webhook_last_update_at,
    });
  } catch (error: unknown) {
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
        "SELECT status, bot_token FROM bots WHERE id = ? AND user_id = ? AND is_deleted = FALSE",
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
        await reactivateBotAfterHealthCheck(id, rows[0].bot_token);
        return NextResponse.json({ success: true, status: "active" });
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

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("DELETE Bot Error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete bot" }, { status: getAuthErrorStatus(error) });
  }
}
