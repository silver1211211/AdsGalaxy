import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";

const NETWORKS = ["AdsGram", "Monetag", "RichAds", "AdExium", "GigaPub", "AdsGalaxyInternal"];

type NetworkRow = RowDataPacket & {
  network_name: string;
  network_placement_id: string | null;
  enabled: number | boolean;
  priority_order: number | null;
};

type MiniAppRow = RowDataPacket & {
  id: number;
  status: string;
};

type SubmittedNetwork = {
  network_name?: unknown;
  network_placement_id?: unknown;
  enabled?: unknown;
  priority_order?: unknown;
};

async function getNetworkState(miniappId: string) {
  const [rows] = await pool.query<NetworkRow[]>(
    `SELECT network_name, network_placement_id, enabled, priority_order
     FROM miniapp_ad_networks
     WHERE miniapp_id = ?
     ORDER BY COALESCE(NULLIF(priority_order, 0), FIELD(network_name, 'AdsGram', 'Monetag', 'RichAds', 'AdExium', 'GigaPub', 'AdsGalaxyInternal')),
       FIELD(network_name, 'AdsGram', 'Monetag', 'RichAds', 'AdExium', 'GigaPub', 'AdsGalaxyInternal'), network_name`,
    [miniappId]
  );

  const existing = new Map(rows.map((row) => [row.network_name, row]));
  return NETWORKS.map((networkName) => {
    const row = existing.get(networkName);
    return {
      network_name: networkName,
      network_placement_id: row?.network_placement_id || "",
      enabled: Boolean(row?.enabled),
      priority_order: Number(row?.priority_order || NETWORKS.indexOf(networkName) + 1),
    };
  }).sort((a, b) => a.priority_order - b.priority_order);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response } = await requireAdminPermission("read");
  if (response) return response;

  try {
    const { id } = await params;
    const [miniapps] = await pool.query<MiniAppRow[]>(
      "SELECT id FROM miniapps WHERE id = ? AND is_deleted = FALSE",
      [id]
    );

    if (miniapps.length === 0) {
      return NextResponse.json({ error: "Mini App not found" }, { status: 404 });
    }

    return NextResponse.json({ networks: await getNetworkState(id) });
  } catch (error: unknown) {
    console.error("Admin Mini App Networks GET Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin, response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const { id } = await params;
    const body = await request.json() as { networks?: unknown; approval_enabled?: unknown };
    const submittedNetworks: SubmittedNetwork[] = Array.isArray(body.networks) ? body.networks : [];
    const approvalEnabled = body.approval_enabled === true;

    const [miniapps] = await pool.query<MiniAppRow[]>(
      "SELECT id, status FROM miniapps WHERE id = ? AND is_deleted = FALSE",
      [id]
    );

    if (miniapps.length === 0) {
      return NextResponse.json({ error: "Mini App not found" }, { status: 404 });
    }

    const previousState = await getNetworkState(id);

    for (const networkName of NETWORKS) {
      const submitted = submittedNetworks.find((item) => item?.network_name === networkName) || {};
      const placementId = String(submitted.network_placement_id || "").trim();
      const enabled = Boolean(submitted.enabled);
      const submittedPriority = Number(submitted.priority_order);
      const priorityOrder = Number.isInteger(submittedPriority) && submittedPriority > 0
        ? submittedPriority
        : NETWORKS.indexOf(networkName) + 1;

      await pool.query(
        `INSERT INTO miniapp_ad_networks (miniapp_id, network_name, network_placement_id, enabled, priority_order)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          network_placement_id = VALUES(network_placement_id),
          enabled = VALUES(enabled),
          priority_order = VALUES(priority_order)`,
        [id, networkName, placementId || null, enabled ? 1 : 0, priorityOrder]
      );
    }

    const newState = await getNetworkState(id);
    const configuredNetworkCount = newState.filter((network) => network.enabled).length;
    const enabledNetworkCount = newState.filter((network) => network.enabled).length;
    const approvableNetworkCount = newState.filter((network) =>
      network.enabled && (network.network_name === "AdsGalaxyInternal" || Boolean(network.network_placement_id.trim()))
    ).length;
    const currentStatus = String(miniapps[0].status || "");
    if (approvalEnabled && approvableNetworkCount < 1) {
      return NextResponse.json({ error: "Configure at least one enabled ad network before approval" }, { status: 400 });
    }

    const newStatus = approvalEnabled
      ? currentStatus === "paused" ? "paused" : "approved"
      : "awaiting";
    if (approvalEnabled) {
      await pool.query(
        "UPDATE miniapps SET status = ?, admin_approved_at = NOW(), admin_approved_by = ? WHERE id = ?",
        [newStatus, admin!.id, id]
      );
    } else {
      await pool.query(
        "UPDATE miniapps SET status = 'awaiting', admin_approved_at = NULL, admin_approved_by = NULL WHERE id = ?",
        [id]
      );
    }

    await recordAdminActionAudit({
      adminId: admin!.id,
      action: "update_miniapp_network",
      entityType: "miniapp",
      entityId: id,
      reason: "admin_network_update",
      metadata: {
        admin_username: admin!.username,
        miniapp_id: Number(id),
        previous_state: previousState,
        new_state: newState,
        previous_status: currentStatus,
        status: newStatus,
        approval_enabled: approvalEnabled,
        configured_network_count: configuredNetworkCount,
        enabled_network_count: enabledNetworkCount,
      },
    });

    return NextResponse.json({
      success: true,
      networks: newState,
      status: newStatus,
      approval_enabled: approvalEnabled,
      configured_network_count: configuredNetworkCount,
      enabled_network_count: enabledNetworkCount,
    });
  } catch (error: unknown) {
    console.error("Admin Mini App Networks PUT Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
