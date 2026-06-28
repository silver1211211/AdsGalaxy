import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";

type MiniAppState = RowDataPacket & {
  id: number;
  user_id: number;
  miniapp_name: string;
  miniapp_username: string;
  status: string;
};

type ConfiguredNetworkCountRow = RowDataPacket & {
  configured_networks: number;
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
    const statusMap: Record<string, string> = {
      await: "awaiting",
      reject: "rejected",
      pause: "paused",
    };

    if (!statusMap[action] && action !== "resume" && action !== "delete") {
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
    if (action === "delete") {
      await pool.query("UPDATE miniapps SET is_deleted = TRUE, status = 'deleted' WHERE id = ?", [id]);

      await recordAdminActionAudit({
        adminId: admin.id,
        action: "delete_miniapp",
        entityType: "miniapp",
        entityId: id,
        reason: "admin_delete",
        metadata: {
          admin_username: admin.username,
          miniapp_id: Number(id),
          previous_state: previousState,
          new_state: {
            ...previousState,
            status: "deleted",
            is_deleted: true,
          },
        },
      });

      return NextResponse.json({ success: true, status: "deleted" });
    }

    let newStatus = statusMap[action];
    if (action === "resume") {
      const [[networkRow]] = await pool.query<ConfiguredNetworkCountRow[]>(
        "SELECT COUNT(*) as configured_networks FROM miniapp_ad_networks WHERE miniapp_id = ? AND enabled = TRUE AND network_name IN ('AdsGram', 'Monetag', 'RichAds', 'AdExium', 'GigaPub', 'AdsGalaxyInternal')",
        [id]
      );
      newStatus = Number(networkRow?.configured_networks || 0) > 0 ? "approved" : "awaiting";
    }

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
