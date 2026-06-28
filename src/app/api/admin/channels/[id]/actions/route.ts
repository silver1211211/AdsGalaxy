import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { ensureDefaultChannelDistribution } from "@/lib/channelLifecycle";
import { sendTelegramMessage } from "@/lib/telegram";

type StatusRow = RowDataPacket & {
  id: number;
  status: string;
  chat_id: string | number;
  title: string | null;
  username: string | null;
  owner_telegram_id: string | number | null;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin, response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const { id } = await params;
    const { action } = await request.json();
    const normalizedAction = action === "deny" ? "reject" : action === "approve" ? "activate" : action;
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
      `SELECT c.id, c.status, c.chat_id, c.title, c.username, u.telegram_id as owner_telegram_id
       FROM channels c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.id = ?
       LIMIT 1`,
      [id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const oldStatus = rows[0].status;
    const newStatus = statusMap[normalizedAction];

    if (normalizedAction === "activate") {
      await pool.query(
        `UPDATE channels
         SET status = 'active',
             is_deleted = FALSE,
             paused_reason = NULL,
             suggested_fix = NULL,
             failure_reason = NULL,
             health_status = 'active',
             health_checked_at = NOW(),
             reactivated_at = NOW()
         WHERE id = ?`,
        [id]
      );
      await ensureDefaultChannelDistribution();
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

    if ((normalizedAction === "activate" || normalizedAction === "reject") && rows[0].owner_telegram_id) {
      const channelLabel = rows[0].username ? `@${rows[0].username}` : "your private channel";
      const message = normalizedAction === "activate"
        ? `✅ <b>Channel Approved!</b>\n\nYour channel <b>${rows[0].title || "Channel"}</b> (${channelLabel}) has been approved and is now active in the advertisements network.`
        : `❌ <b>Channel Rejected</b>\n\nUnfortunately, your channel <b>${rows[0].title || "Channel"}</b> (${channelLabel}) was not approved for monetization at this time.`;

      await sendTelegramMessage(rows[0].owner_telegram_id, message).catch((notifyError: unknown) => {
        const notifyMessage = notifyError instanceof Error ? notifyError.message : "Unknown notification error";
        console.warn("Admin channel notification failed", { channel_id: id, action: normalizedAction, error: notifyMessage });
      });
    }

    await recordAdminActionAudit({
      adminId: admin?.id,
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
