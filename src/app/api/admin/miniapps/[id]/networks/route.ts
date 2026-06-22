import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getAuthenticatedAdmin } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";

const NETWORKS = ["AdsGram", "Monetag", "AdExium", "RichAds"];

type NetworkRow = RowDataPacket & {
  network_name: string;
  network_placement_id: string | null;
  enabled: number | boolean;
  priority_order: number | null;
};

async function getNetworkState(miniappId: string) {
  const [rows] = await pool.query<NetworkRow[]>(
    `SELECT network_name, network_placement_id, enabled, priority_order
     FROM miniapp_ad_networks
     WHERE miniapp_id = ?
     ORDER BY COALESCE(NULLIF(priority_order, 0), FIELD(network_name, 'AdsGram', 'Monetag', 'AdExium', 'RichAds')),
       FIELD(network_name, 'AdsGram', 'Monetag', 'AdExium', 'RichAds'), network_name`,
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
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const [miniapps]: any = await pool.query(
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
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const submittedNetworks = Array.isArray(body.networks) ? body.networks : [];

    const [miniapps]: any = await pool.query(
      "SELECT id, status FROM miniapps WHERE id = ? AND is_deleted = FALSE",
      [id]
    );

    if (miniapps.length === 0) {
      return NextResponse.json({ error: "Mini App not found" }, { status: 404 });
    }

    if (miniapps[0].status !== "approved") {
      return NextResponse.json({ error: "Approve the Mini App before configuring networks" }, { status: 400 });
    }

    const previousState = await getNetworkState(id);

    for (const networkName of NETWORKS) {
      const submitted = submittedNetworks.find((item: any) => item?.network_name === networkName) || {};
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

    await recordAdminActionAudit({
      adminId: admin.id,
      action: "update_miniapp_network",
      entityType: "miniapp",
      entityId: id,
      reason: "admin_network_update",
      metadata: {
        admin_username: admin.username,
        miniapp_id: Number(id),
        previous_state: previousState,
        new_state: newState,
      },
    });

    return NextResponse.json({ success: true, networks: newState });
  } catch (error: unknown) {
    console.error("Admin Mini App Networks PUT Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
