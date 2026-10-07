import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { BotActivationHealthError, reactivateBotAfterHealthCheck } from "@/lib/botLifecycle";
import { isBotEncryptionError, loadBotToken } from "@/lib/botIntegration";
import { notifyBotApproved, notifyBotRejected, notifyBotRemoved, notifyBotPaused } from "@/lib/publisherNotifications";
import { rejectEntityWithPolicy } from "@/lib/moderationRejections";

type StatusRow = RowDataPacket & {
  id: number;
  status: string;
  bot_token: string;
  bot_token_encrypted: string | null;
  bot_username: string | null;
  telegram_id: string | number | null;
};

async function getBotColumns() {
  const [rows] = await pool.query<Array<RowDataPacket & { COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'bots'`
  );

  return new Set(rows.map((row) => row.COLUMN_NAME));
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin, response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const { id } = await params;
    const { action } = await request.json();
    const normalizedAction = action === "deny" ? "reject" : action;
    if (normalizedAction === "reject") return NextResponse.json({ error: "MODERATION_REASON_REQUIRED", code: "MODERATION_REASON_REQUIRED" }, { status: 400 });
    const statusMap: Record<string, string> = {
      activate: "active",
      pause: "paused",
      reject: "rejected",
      deny: "rejected",
      delete: "deleted",
    };

    if (!statusMap[normalizedAction]) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const [rows] = await pool.query<StatusRow[]>(
      `SELECT b.id, b.status, b.bot_token, b.bot_token_encrypted, b.bot_username, u.telegram_id
       FROM bots b JOIN users u ON u.id = b.user_id
       WHERE b.id = ?`,
      [id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }

    const oldStatus = rows[0].status;
    const newStatus = statusMap[normalizedAction];
    const botColumns = await getBotColumns();
    if (normalizedAction === "activate") {
      try {
        await reactivateBotAfterHealthCheck(id, await loadBotToken(pool, { ...rows[0], id }), pool, new URL(request.url).origin);
      } catch (error) {
        if (error instanceof BotActivationHealthError) {
          if (error.health.permanent && ["token_invalid", "bot_deleted"].includes(error.health.status)) {
            await rejectEntityWithPolicy({
              entityType: "bot",
              entityId: id,
              ruleKey: "publisher.bot.invalid-integration",
              publicRuleNumber: 4,
              internalNote: "Telegram getMe explicitly rejected the stored bot credential.",
              adminId: Number(admin?.id || 0),
            });
            if (oldStatus !== "rejected") {
              await notifyBotRejected(rows[0].telegram_id, id, rows[0].bot_username || "");
            }
            await recordAdminActionAudit({
              adminId: admin?.id,
              action: "bot_rejected_invalid_integration",
              entityType: "bot",
              entityId: id,
              reason: "telegram_getme_invalid_token",
              metadata: { old_status: oldStatus, new_status: "rejected", policy_rule: 4 },
            });
            return NextResponse.json({ success: true, status: "rejected", approval_result: "rejected_invalid_integration" });
          }
          const retryAfterSeconds = Number(error.health.retryAfterSeconds || 0);
          return NextResponse.json({
            error: "Telegram verification is temporarily unavailable; the bot remains pending.",
            code: "TEMPORARILY_UNVERIFIED",
            approval_result: "temporarily_unverified",
            retry_after_seconds: retryAfterSeconds || null,
            retry_at: retryAfterSeconds ? new Date(Date.now() + retryAfterSeconds * 1000).toISOString() : null,
          }, { status: 409 });
        }
        throw error;
      }
    } else if (normalizedAction === "delete") {
      const { assignments, params } = updateAssignable(botColumns, {
        status: newStatus,
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
        status: newStatus,
        paused_reason: "Paused by admin.",
        suggested_fix: "Resolve the admin review item, then reactivate.",
        health_status: "paused",
      });
      if (assignments.length > 0) {
        await pool.query(`UPDATE bots SET ${assignments.join(", ")}, notification_state_version=notification_state_version+1 WHERE id = ? AND status<>'paused'`, [...params, id]);
      }
    } else {
      await pool.query("UPDATE bots SET status = ? WHERE id = ?", [newStatus, id]);
    }

    // Gated on the pre-update status so a retried/duplicate action (same
    // status already in place) never sends a second notification.
    const botUsername = rows[0].bot_username || "";
    if (normalizedAction === "activate" && oldStatus !== "active") {
      await notifyBotApproved(rows[0].telegram_id, id, botUsername);
    } else if (normalizedAction === "reject" && oldStatus !== "rejected") {
      await notifyBotRejected(rows[0].telegram_id, id, botUsername);
    } else if (normalizedAction === "delete" && oldStatus !== "deleted") {
      await notifyBotRemoved(rows[0].telegram_id, id, botUsername);
    } else if (normalizedAction === "pause" && oldStatus !== "paused") {
      const [[version]] = await pool.query<Array<RowDataPacket & { notification_state_version: number }>>(
        "SELECT notification_state_version FROM bots WHERE id=?", [id]);
      await notifyBotPaused(rows[0].telegram_id, id, botUsername, Number(version?.notification_state_version || 1));
    }

    await recordAdminActionAudit({
      action: `bot_${normalizedAction}`,
      entityType: "bot",
      entityId: id,
      reason: `admin_${normalizedAction}`,
      metadata: {
        old_status: oldStatus,
        new_status: newStatus,
      },
    });

    return NextResponse.json({ success: true, status: newStatus });
  } catch (error: unknown) {
    console.error("Admin Bot Action Error:", error);
    if (isBotEncryptionError(error)) {
      return NextResponse.json({ error: "Bot credential encryption configuration error", code: error.code }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
