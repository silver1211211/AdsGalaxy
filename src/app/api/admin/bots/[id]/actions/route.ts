import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { reactivateBotAfterHealthCheck } from "@/lib/botLifecycle";

type StatusRow = RowDataPacket & {
  id: number;
  status: string;
  bot_token: string;
};

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

    const [rows] = await pool.query<StatusRow[]>("SELECT id, status, bot_token FROM bots WHERE id = ?", [id]);
    if (rows.length === 0) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }

    const oldStatus = rows[0].status;
    const newStatus = statusMap[normalizedAction];

    if (normalizedAction === "activate") {
      await reactivateBotAfterHealthCheck(id, rows[0].bot_token);
    } else if (normalizedAction === "delete") {
      await pool.query(
        `UPDATE bots
         SET status = ?, is_deleted = TRUE, paused_reason = 'Bot removed by admin.', suggested_fix = 'Contact support if this was unexpected.', health_status = 'paused'
         WHERE id = ?`,
        [newStatus, id]
      );
    } else if (normalizedAction === "pause") {
      await pool.query(
        `UPDATE bots
         SET status = ?, paused_reason = 'Paused by admin.', suggested_fix = 'Resolve the admin review item, then reactivate.', health_status = 'paused'
         WHERE id = ?`,
        [newStatus, id]
      );
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
    const message = error instanceof Error ? error.message : "Internal Server Error";
    console.error("Admin Bot Action Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
