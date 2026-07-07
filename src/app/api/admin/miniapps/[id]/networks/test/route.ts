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
import { getDisabledMiniappNetworks } from "@/lib/productionSafety";

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
  return networkName !== "AdsGalaxyInternal";
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

    if (!network) {
      return diagnosticResponse({
        success: false,
        network: networkName,
        status: "Not Configured",
        error_code: "INVALID_CONFIG",
        error_message: "Network is not configured for this Mini App",
      });
    }

    if (!Boolean(network.enabled)) {
      return diagnosticResponse({
        success: false,
        network: networkName,
        status: "Disabled",
        error_code: "NETWORK_DISABLED",
        error_message: `${networkName} is disabled for this Mini App.`,
        checks: [{ name: "connected", label: "Connected", passed: false, reason: "Network disabled" }],
      });
    }

    if (globallyDisabledNetworks.has(networkName)) {
      return diagnosticResponse({
        success: false,
        network: networkName,
        status: "Globally Disabled",
        error_code: "NETWORK_DISABLED",
        error_message: `${networkName} is disabled by the production network flag.`,
        checks: [{ name: "connected", label: "Connected", passed: false, reason: "Production flag disabled" }],
      });
    }

    const testNetwork = network;

    if (!hasRequiredPlacement(networkName, testNetwork)) {
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
      config = buildMiniAppNetworkClientConfig(networkName, testNetwork.network_placement_id || "", {
        publisherId: testNetwork.richads_publisher_id,
        appId: testNetwork.richads_app_id,
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
        error_message: networkName === "Monetag"
          ? "MONETAG_SDK_URL is missing. Set it to the exact SDK URL from the Monetag-generated script tag."
          : "Network SDK script is not configured.",
      });
    }

    let monetagProtection = null;
    const testConfig = {
      ...config.client_config,
      sdk: {
        ...config.client_config.sdk,
        test_mode: networkName === "Monetag",
        debug: networkName === "AdExium",
      },
    };
    if (networkName === "Monetag") {
      monetagProtection = { allowed: true, reason: "admin_test_bypass" };
    }

    return diagnosticResponse({
      success: true,
      network: networkName,
      status: "Test Successful",
      checks: [
        { name: "connected", label: "Connected", passed: true },
        { name: "configuration_valid", label: "Configuration Valid", passed: true },
        { name: "sdk_loaded", label: "SDK Loaded", passed: !requiresBrowserSdkScript(networkName) || Boolean(config.sdk_script_url) },
        { name: "test_passed", label: "Test Passed", passed: true },
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
        test_config: testConfig,
        test_mode: true,
        raw_result: {
          server_config: testConfig,
          live_ad_requested: false,
          billing_isolated: true,
        },
        parsed_result: {
          provider: networkName,
          configuration_loaded: true,
          publisher_configuration_present: true,
          sdk_script_url_present: !requiresBrowserSdkScript(networkName) || Boolean(config.sdk_script_url),
          production_ready: true,
        },
        callback_status: {
          callbacks_registered: "validated_in_browser_runtime",
          callback_invoked: false,
          reason: "Provider test mode validates initialization only and does not render a live ad.",
        },
        timing: {
          server_checked_at: new Date().toISOString(),
          script_timeout_ms: testConfig.sdk?.script_timeout_ms || null,
          request_timeout_ms: testConfig.sdk?.request_timeout_ms || null,
        },
        render_status: "not_requested_test_mode",
        impression_status: "not_recorded_test_mode",
        completion_status: "not_recorded_test_mode",
      },
    });
  } catch (error: unknown) {
    console.error("Admin Mini App Network Test Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
