import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getAuthenticatedAdmin } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";

type MiniAppState = RowDataPacket & {
  id: number;
  user_id: number;
  miniapp_name: string;
  miniapp_username: string;
  status: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const { action } = await request.json();
    const statusMap: Record<string, string> = {
      approve: "approved",
      reject: "rejected",
    };

    if (!statusMap[action]) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const [rows] = await pool.query<MiniAppState[]>(
      "SELECT id, user_id, miniapp_name, miniapp_username, status FROM miniapps WHERE id = ? AND is_deleted = FALSE",
      [id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Mini App not found" }, { status: 404 });
    }

    const previousState = rows[0];
    const newStatus = statusMap[action];

    await pool.query("UPDATE miniapps SET status = ? WHERE id = ?", [newStatus, id]);

    await recordAdminActionAudit({
      adminId: admin.id,
      action: `${action}_miniapp`,
      entityType: "miniapp",
      entityId: id,
      reason: `admin_${action}`,
      metadata: {
        admin_username: admin.username,
        miniapp_id: Number(id),
        previous_state: previousState,
        new_state: {
          ...previousState,
          status: newStatus,
        },
      },
    });

    return NextResponse.json({ success: true, status: newStatus });
  } catch (error: unknown) {
    console.error("Admin Mini App Action Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
