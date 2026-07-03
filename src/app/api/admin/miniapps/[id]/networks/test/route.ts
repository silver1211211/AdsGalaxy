/* eslint-disable @typescript-eslint/no-explicit-any -- adapter errors are normalized into admin diagnostics */
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import {
  buildMiniAppNetworkClientConfig,
  isMiniAppNetworkName,
  type MiniAppNetworkName,
} from "@/lib/miniappNetworkAdapters";
import { canShowMonetag } from "@/lib/miniappMonetagProtection";

type MiniAppRow = RowDataPacket & {
  id: number;
  status: string;
};

type NetworkRow = RowDataPacket & {
  network_name: string;
  network_placement_id: string | null;
  enabled: number | boolean;
  richads_publisher_id: string | null;
  richads_app_id: string | null;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const networkName = cleanText(body.network_name);

    if (!isMiniAppNetworkName(networkName)) {
      return NextResponse.json({ error: "Valid network_name is required" }, { status: 400 });
    }

    const [miniapps] = await pool.query<MiniAppRow[]>(
      "SELECT id, status FROM miniapps WHERE id = ? AND is_deleted = FALSE",
      [id]
    );

    if (miniapps.length === 0) {
      return NextResponse.json({ error: "Mini App not found" }, { status: 404 });
    }

    if (!["awaiting", "approved", "monetized"].includes(miniapps[0].status)) {
      return NextResponse.json({ error: "Mini App must be awaiting approval before adapter testing" }, { status: 400 });
    }

    const [networks] = await pool.query<NetworkRow[]>(
      `SELECT network_name, network_placement_id, enabled, richads_publisher_id, richads_app_id
       FROM miniapp_ad_networks
       WHERE miniapp_id = ? AND network_name = ?
       LIMIT 1`,
      [id, networkName]
    );

    if (networks.length === 0 || !Boolean(networks[0].enabled)) {
      return NextResponse.json({
        success: false,
        network: networkName,
        error_code: "NETWORK_DISABLED",
        error_message: "Network is disabled or not configured for this Mini App",
      }, { status: 400 });
    }

    let config;
    try {
      config = buildMiniAppNetworkClientConfig(networkName as MiniAppNetworkName, networks[0].network_placement_id || "", {
        publisherId: networks[0].richads_publisher_id,
        appId: networks[0].richads_app_id,
      });
    } catch (error: any) {
      return NextResponse.json({
        success: false,
        network: networkName,
        error_code: "INVALID_CONFIG",
        error_message: error?.message || "Network configuration is invalid",
      }, { status: 400 });
    }

    const monetagProtection = networkName === "Monetag"
      ? await canShowMonetag(id, "admin_test")
      : null;

    return NextResponse.json({
      success: true,
      network: networkName,
      adapter_initialization: {
        sdk_script_url: config.sdk_script_url,
        sdk_global_name: config.sdk_global_name,
        supports_rewarded: config.supports_rewarded,
        supports_interstitial: config.supports_interstitial,
        supports_banner: config.supports_banner,
        required_id_label: config.required_id_label,
      },
      monetag_protection: monetagProtection,
      live_ad_requested: false,
      impression_recorded: false,
    });
  } catch (error: unknown) {
    console.error("Admin Mini App Network Test Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
