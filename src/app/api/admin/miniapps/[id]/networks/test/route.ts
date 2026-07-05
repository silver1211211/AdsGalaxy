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
import { getDisabledMiniappNetworks, isMonetagTestModeEnabled } from "@/lib/productionSafety";

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

function diagnosticResponse(input: {
  success: boolean;
  network: string;
  status: string;
  error_code?: string;
  error_message?: string;
  checks?: Array<Record<string, unknown>>;
  extra?: Record<string, unknown>;
}) {
  return NextResponse.json({
    success: input.success,
    network: input.network,
    status: input.status,
    status_label: input.status,
    error_code: input.error_code,
    error_message: input.error_message,
    checks: input.checks || [],
    live_ad_requested: false,
    impression_recorded: false,
    ...(input.extra || {}),
  });
}

function hasRequiredPlacement(networkName: MiniAppNetworkName, network: NetworkRow) {
  if (networkName === "AdsGalaxyInternal") return true;
  if (networkName === "RichAds") {
    return Boolean(cleanText(network.richads_publisher_id) && cleanText(network.richads_app_id || network.network_placement_id));
  }
  return Boolean(cleanText(network.network_placement_id));
}

function requiresBrowserSdkScript(networkName: MiniAppNetworkName) {
  return networkName !== "Monetag" && networkName !== "AdsGalaxyInternal";
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

    if (!["approved", "monetized"].includes(miniapps[0].status)) {
      return diagnosticResponse({
        success: false,
        network: networkName,
        status: "Waiting Approval",
        error_code: "WAITING_APPROVAL",
        error_message: "Mini App must be approved or monetized before this network can serve.",
      });
    }

    const [allNetworks] = await pool.query<NetworkRow[]>(
      `SELECT network_name, network_placement_id, enabled, richads_publisher_id, richads_app_id
       FROM miniapp_ad_networks
       WHERE miniapp_id = ?`,
      [id]
    );
    const network = allNetworks.find((row) => row.network_name === networkName);
    const globallyDisabledNetworks = await getDisabledMiniappNetworks();
    const enabledNetworks = allNetworks
      .filter((row) => Boolean(row.enabled) && !globallyDisabledNetworks.has(row.network_name))
      .map((row) => row.network_name);

    if (!network || !Boolean(network.enabled) || globallyDisabledNetworks.has(networkName)) {
      return diagnosticResponse({
        success: false,
        network: networkName,
        status: "Disabled",
        error_code: "NETWORK_DISABLED",
        error_message: "Network is disabled or not configured for this Mini App",
        checks: [
          { name: "miniapp_network_enabled", passed: Boolean(network?.enabled) },
          { name: "global_network_enabled", passed: !globallyDisabledNetworks.has(networkName) },
        ],
      });
    }

    if (!hasRequiredPlacement(networkName, network)) {
      return diagnosticResponse({
        success: false,
        network: networkName,
        status: "Missing Placement",
        error_code: "MISSING_PLACEMENT",
        error_message: "Network placement configuration is incomplete.",
      });
    }

    let config;
    try {
      config = buildMiniAppNetworkClientConfig(networkName, network.network_placement_id || "", {
        publisherId: network.richads_publisher_id,
        appId: network.richads_app_id,
      });
    } catch (error: any) {
      return diagnosticResponse({
        success: false,
        network: networkName,
        status: "Configuration Error",
        error_code: "INVALID_CONFIG",
        error_message: error?.message || "Network configuration is invalid",
      });
    }

    if (requiresBrowserSdkScript(networkName) && !config.sdk_script_url) {
      return diagnosticResponse({
        success: false,
        network: networkName,
        status: "SDK Missing",
        error_code: "SDK_MISSING",
        error_message: "Network SDK script is not configured.",
      });
    }

    let monetagProtection = null;
    if (networkName === "Monetag") {
      const monetagOnlyEnabled = enabledNetworks.length === 1 && enabledNetworks[0] === "Monetag";
      const monetagTestMode = await isMonetagTestModeEnabled();
      monetagProtection = monetagOnlyEnabled && monetagTestMode
        ? { allowed: true, reason: "test_mode" }
        : await canShowMonetag(id, "admin_test");
      if ((monetagOnlyEnabled && !monetagTestMode) || !monetagProtection.allowed) {
        return diagnosticResponse({
          success: false,
          network: networkName,
          status: "Protection Active",
          error_code: "PROTECTION_ACTIVE",
          error_message: monetagOnlyEnabled && !monetagTestMode
            ? "Monetag is the only enabled network. Enable Monetag Test Mode before serving it in this state."
            : "Monetag frequency protection is active.",
          extra: {
            monetag_protection: monetagProtection,
            monetag_test_mode_enabled: monetagTestMode,
          },
        });
      }
    }

    return diagnosticResponse({
      success: true,
      network: networkName,
      status: "Test Successful",
      checks: [
        { name: "miniapp_approved", passed: true },
        { name: "network_enabled", passed: true },
        { name: "placement_configured", passed: true },
        { name: "sdk_available", passed: !requiresBrowserSdkScript(networkName) || Boolean(config.sdk_script_url) },
      ],
      extra: {
        readiness: "Ready",
        adapter_initialization: {
          sdk_available: !requiresBrowserSdkScript(networkName) || Boolean(config.sdk_script_url),
          sdk_runtime: networkName === "Monetag" ? "package" : networkName === "AdsGalaxyInternal" ? "internal" : "browser_script",
          supports_rewarded: config.supports_rewarded,
          supports_interstitial: config.supports_interstitial,
          supports_banner: config.supports_banner,
          required_id_label: config.required_id_label,
        },
        monetag_protection: monetagProtection,
      },
    });
  } catch (error: unknown) {
    console.error("Admin Mini App Network Test Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
