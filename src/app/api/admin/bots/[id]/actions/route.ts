import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { reactivateBotAfterHealthCheck } from "@/lib/botLifecycle";
import { isBotEncryptionError, loadBotToken } from "@/lib/botIntegration";

type StatusRow = RowDataPacket & {
  id: number;
  status: string;
  bot_token: string;
  bot_token_encrypted: string | null;
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
  const { response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const { id } = await params;
    const { action } = await request.json();
    const normalizedAction = action === "deny" ? "reject" : action;
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

    const [rows] = await pool.query<StatusRow[]>("SELECT id, status, bot_token, bot_token_encrypted FROM bots WHERE id = ?", [id]);
    if (rows.length === 0) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }

    const oldStatus = rows[0].status;
    const newStatus = statusMap[normalizedAction];
    const botColumns = await getBotColumns();
    if (normalizedAction === "activate") {
      await reactivateBotAfterHealthCheck(id, await loadBotToken(pool, { ...rows[0], id }), pool, new URL(request.url).origin);
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
        await pool.query(`UPDATE bots SET ${assignments.join(", ")} WHERE id = ?`, [...params, id]);
      }
    } else {
      await pool.query("UPDATE bots SET status = ? WHERE id = ?", [newStatus, id]);
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
