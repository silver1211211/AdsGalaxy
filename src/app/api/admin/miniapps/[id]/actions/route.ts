import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { notifyMiniAppApproved, notifyMiniAppRejected, notifyMiniAppRemoved } from "@/lib/publisherNotifications";

type MiniAppState = RowDataPacket & {
  id: number;
  user_id: number;
  miniapp_name: string;
  miniapp_username: string;
  status: string;
  admin_approved_at: Date | string | null;
  telegram_id: string | number | null;
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
      approve: "approved",
      reject: "rejected",
      pause: "paused",
    };

    if (!statusMap[action] && action !== "resume" && action !== "delete") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const [rows] = await pool.query<MiniAppState[]>(
      `SELECT ma.id, ma.user_id, ma.miniapp_name, ma.miniapp_username, ma.status, ma.admin_approved_at, u.telegram_id
       FROM miniapps ma JOIN users u ON u.id = ma.user_id
       WHERE ma.id = ? AND ma.is_deleted = FALSE`,
      [id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Mini App not found" }, { status: 404 });
    }

    const previousState = rows[0];
    if (action === "approve") {
      if (previousState.status !== "awaiting") {
        return NextResponse.json({ error: "Mini App must be awaiting manual approval" }, { status: 400 });
      }
      const [[networkRow]] = await pool.query<ConfiguredNetworkCountRow[]>(
        `SELECT COUNT(*) as configured_networks
         FROM miniapp_ad_networks
         WHERE miniapp_id = ? AND enabled = TRUE
           AND (network_name = 'AdsGalaxyInternal' OR COALESCE(network_placement_id, '') != '')`,
        [id]
      );
      if (Number(networkRow?.configured_networks || 0) < 1) {
        return NextResponse.json({ error: "Configure at least one enabled ad network before approval" }, { status: 400 });
      }
    }
    if (action === "delete") {
      await pool.query("UPDATE miniapps SET is_deleted = TRUE, status = 'deleted' WHERE id = ?", [id]);
      await notifyMiniAppRemoved(previousState.telegram_id, id, previousState.miniapp_name);

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
      newStatus = previousState.admin_approved_at && Number(networkRow?.configured_networks || 0) > 0 ? "approved" : "awaiting";
    }

    if (action === "approve") {
      await pool.query(
        "UPDATE miniapps SET status = 'approved', admin_approved_at = NOW(), admin_approved_by = ? WHERE id = ?",
        [admin.id, id]
      );
    } else if (action === "await") {
      await pool.query(
        "UPDATE miniapps SET status = 'awaiting', admin_approved_at = NULL, admin_approved_by = NULL WHERE id = ?",
        [id]
      );
    } else {
      await pool.query("UPDATE miniapps SET status = ? WHERE id = ?", [newStatus, id]);
    }

    if (action === "reject" && previousState.status !== "rejected") {
      await notifyMiniAppRejected(previousState.telegram_id, id, previousState.miniapp_name);
    } else if (newStatus === "approved" && previousState.status !== "approved") {
      await notifyMiniAppApproved(previousState.telegram_id, id, previousState.miniapp_name);
    }

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
