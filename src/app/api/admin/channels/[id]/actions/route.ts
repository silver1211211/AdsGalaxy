import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";

type StatusRow = RowDataPacket & {
  id: number;
  status: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const { action } = await request.json();
    const statusMap: Record<string, string> = {
      activate: "active",
      pause: "paused",
      reject: "rejected",
    };

    if (!statusMap[action]) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const [rows] = await pool.query<StatusRow[]>("SELECT id, status FROM channels WHERE id = ?", [id]);
    if (rows.length === 0) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const oldStatus = rows[0].status;
    const newStatus = statusMap[action];

    if (action === "activate") {
      await pool.query("UPDATE channels SET status = ?, is_deleted = FALSE WHERE id = ?", [newStatus, id]);
    } else {
      await pool.query("UPDATE channels SET status = ? WHERE id = ?", [newStatus, id]);
    }

    await recordAdminActionAudit({
      action: `channel_${action}`,
      entityType: "channel",
      entityId: id,
      reason: `admin_${action}`,
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
