import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { reactivateChannelAfterHealthCheck } from "@/lib/channelLifecycle";

type StatusRow = RowDataPacket & {
  id: number;
  status: string;
  chat_id: string | number;
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

    const [rows] = await pool.query<StatusRow[]>("SELECT id, status, chat_id FROM channels WHERE id = ?", [id]);
    if (rows.length === 0) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const oldStatus = rows[0].status;
    const newStatus = statusMap[normalizedAction];

    if (normalizedAction === "activate") {
      await reactivateChannelAfterHealthCheck(id, rows[0].chat_id);
    } else if (normalizedAction === "delete") {
      await pool.query("UPDATE channels SET status = ?, is_deleted = TRUE, paused_reason = 'Deleted by admin.', suggested_fix = NULL WHERE id = ?", [newStatus, id]);
    } else {
      await pool.query("UPDATE channels SET status = ?, paused_reason = ?, suggested_fix = ? WHERE id = ?", [
        newStatus,
        newStatus === "paused" ? "Paused by admin." : null,
        newStatus === "paused" ? "Contact support or reactivate after fixing channel access." : null,
        id,
      ]);
    }

    await recordAdminActionAudit({
      action: `channel_${normalizedAction}`,
      entityType: "channel",
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
    console.error("Admin Channel Action Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
