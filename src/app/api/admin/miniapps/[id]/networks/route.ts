import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { getMiniAppProviderDiagnostics } from "@/lib/miniappProviderDiagnostics";
import type { MiniAppNetworkName } from "@/lib/miniappNetworkAdapters";
import { getMiniAppNetworkAdapter } from "@/lib/miniappNetworkAdapters";

const NETWORKS = ["AdsGalaxyInternal", "AdsGram", "GigaPub", "AdExium", "Monetag", "RichAds"];

type NetworkRow = RowDataPacket & {
  network_name: string;
  network_placement_id: string | null;
  enabled: number | boolean;
  monetag_test_mode: number | boolean | null;
  priority_order: number | null;
  richads_publisher_id: string | null;
  richads_app_id: string | null;
};

type MiniAppRow = RowDataPacket & {
  id: number;
  status: string;
};

type SubmittedNetwork = {
  network_name?: unknown;
  network_placement_id?: unknown;
  enabled?: unknown;
  monetag_test_mode?: unknown;
  priority_order?: unknown;
  richads_publisher_id?: unknown;
  richads_app_id?: unknown;
};

function missingProviderConfiguration(networkName: string, submitted: SubmittedNetwork) {
  if (!Boolean(submitted.enabled) || networkName === "AdsGalaxyInternal") return [];

  const placementId = String(submitted.network_placement_id || "").trim();
  const richAdsPublisherId = String(submitted.richads_publisher_id || "").trim();
  const richAdsAppId = String(submitted.richads_app_id || "").trim();
  const errors: string[] = [];

  if (networkName === "AdsGram" && !placementId) errors.push("Missing AdsGram Placement ID");
  if (networkName === "GigaPub" && !placementId) errors.push("Missing GigaPub Project ID");
  if (networkName === "AdExium" && !placementId) errors.push("Missing AdExium Widget ID");
  if (networkName === "Monetag") {
    if (!placementId) errors.push("Missing Monetag Zone ID");
    const monetagSdkUrl = getMiniAppNetworkAdapter("Monetag").client_config_shape.sdk.script_url;
    if (!monetagSdkUrl?.trim()) errors.push("Missing Monetag SDK URL");
  }
  if (networkName === "RichAds") {
    if (!richAdsPublisherId) errors.push("Missing RichAds Publisher ID");
    if (!richAdsAppId) errors.push("Missing RichAds App ID");
  }

  return errors;
}

async function getNetworkState(miniappId: string) {
  const [rows] = await pool.query<NetworkRow[]>(
    `SELECT network_name, network_placement_id, enabled, COALESCE(monetag_test_mode, 0) as monetag_test_mode, priority_order, richads_publisher_id, richads_app_id
     FROM miniapp_ad_networks
     WHERE miniapp_id = ?
     ORDER BY COALESCE(NULLIF(priority_order, 0), FIELD(network_name, 'AdsGalaxyInternal', 'AdsGram', 'GigaPub', 'AdExium', 'Monetag', 'RichAds')),
       FIELD(network_name, 'AdsGalaxyInternal', 'AdsGram', 'GigaPub', 'AdExium', 'Monetag', 'RichAds'), network_name`,
    [miniappId]
  );

  const existing = new Map(rows.map((row) => [row.network_name, row]));
  return NETWORKS.map((networkName) => {
    const row = existing.get(networkName);
    return {
      network_name: networkName,
      network_placement_id: row?.network_placement_id || "",
      enabled: Boolean(row?.enabled),
      monetag_test_mode: networkName === "Monetag" ? Boolean(row?.monetag_test_mode) : false,
      priority_order: Number(row?.priority_order || NETWORKS.indexOf(networkName) + 1),
      ...(networkName === "RichAds" ? {
        richads_publisher_id: row?.richads_publisher_id || "",
        richads_app_id: row?.richads_app_id || row?.network_placement_id || "",
        integration_status: !row?.enabled ? "Disabled" : !row?.richads_publisher_id ? "Missing Publisher ID" : !(row?.richads_app_id || row?.network_placement_id) ? "Missing App ID" : "Ready",
      } : {}),
    };
  }).sort((a, b) => a.priority_order - b.priority_order);
}

async function getNetworkStateWithDiagnostics(miniappId: string) {
  const [networks, diagnostics] = await Promise.all([
    getNetworkState(miniappId),
    getMiniAppProviderDiagnostics(miniappId, pool),
  ]);
  const diagnosticsByProvider = new Map(diagnostics.map((item) => [item.provider, item]));
  return networks.map((network) => ({
    ...network,
    diagnostics: diagnosticsByProvider.get(network.network_name as MiniAppNetworkName) || null,
  }));
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

    return NextResponse.json({ networks: await getNetworkStateWithDiagnostics(id) });
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
    const validationErrors: string[] = [];
    for (const networkName of NETWORKS) {
      const submitted = submittedNetworks.find((item) => item?.network_name === networkName) || {};
      validationErrors.push(...missingProviderConfiguration(networkName, submitted));
    }

    if (validationErrors.length > 0) {
      return NextResponse.json({
        error: `Cannot enable provider: ${validationErrors.join("; ")}`,
        validation_errors: validationErrors,
      }, { status: 400 });
    }

    for (const networkName of NETWORKS) {
      const submitted = submittedNetworks.find((item) => item?.network_name === networkName) || {};
      const placementId = String(submitted.network_placement_id || "").trim();
      const enabled = Boolean(submitted.enabled);
      const submittedPriority = Number(submitted.priority_order);
      const priorityOrder = Number.isInteger(submittedPriority) && submittedPriority > 0
        ? submittedPriority
        : NETWORKS.indexOf(networkName) + 1;
      const richAdsPublisherId = networkName === "RichAds" ? String(submitted.richads_publisher_id || "").trim() : null;
      const richAdsAppId = networkName === "RichAds" ? String(submitted.richads_app_id || "").trim() : null;
      const effectivePlacementId = networkName === "RichAds" ? richAdsAppId : placementId;
      const monetagTestMode = networkName === "Monetag" && submitted.monetag_test_mode === true;

      await pool.query(
        `INSERT INTO miniapp_ad_networks (miniapp_id, network_name, network_placement_id, richads_publisher_id, richads_app_id, enabled, monetag_test_mode, priority_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          network_placement_id = VALUES(network_placement_id),
          richads_publisher_id = VALUES(richads_publisher_id),
          richads_app_id = VALUES(richads_app_id),
          enabled = VALUES(enabled),
          monetag_test_mode = VALUES(monetag_test_mode),
          priority_order = VALUES(priority_order)`,
        [id, networkName, effectivePlacementId || null, richAdsPublisherId || null, richAdsAppId || null, enabled ? 1 : 0, monetagTestMode ? 1 : 0, priorityOrder]
      );
    }

    const newState = await getNetworkState(id);
    const configuredNetworkCount = newState.filter((network) =>
      network.network_name === "AdsGalaxyInternal"
        ? network.enabled
        : network.network_name === "RichAds"
          ? Boolean(network.richads_publisher_id?.trim() && network.richads_app_id?.trim())
          : Boolean(network.network_placement_id.trim())
    ).length;
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
