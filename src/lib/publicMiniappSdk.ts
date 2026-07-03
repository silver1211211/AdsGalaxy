import {
  buildMiniAppNetworkClientConfig,
  type MiniAppNetworkName,
} from "@/lib/miniappNetworkAdapters";

const adapterKeys: Record<MiniAppNetworkName, string> = {
  AdsGram: "a",
  Monetag: "m",
  AdExium: "x",
  RichAds: "r",
  GigaPub: "g",
  AdsGalaxyInternal: "i",
};

export function publicAdapterKey(networkName: MiniAppNetworkName) {
  return adapterKeys[networkName];
}

export function toPublicMediationDecision(decision: {
  success: boolean;
  request_id?: string;
  selected_network?: MiniAppNetworkName;
  network_placement_id?: string;
  richads_publisher_id?: string;
  richads_app_id?: string;
  internal_ad?: Record<string, unknown> | null;
  fallback_available?: boolean;
  ad_format?: string;
  error_code?: string;
  decision_reason?: string;
  message?: string;
}) {
  if (!decision.success || !decision.selected_network || !decision.request_id) {
    return {
      success: false,
      request_id: decision.request_id,
      fallback_available: false,
      error_code: decision.error_code || "NO_FILL",
      message: decision.message || "No ad available right now.",
    };
  }

  if (decision.selected_network === "AdsGalaxyInternal") {
    return {
      success: true,
      request_id: decision.request_id,
      adapter: publicAdapterKey(decision.selected_network),
      fallback_available: Boolean(decision.fallback_available),
      ad_format: decision.ad_format || "rewarded",
      ad: decision.internal_ad || null,
    };
  }

  const config = buildMiniAppNetworkClientConfig(decision.selected_network, decision.network_placement_id || "", {
    publisherId: decision.richads_publisher_id,
    appId: decision.richads_app_id,
  });
  return {
    success: true,
    request_id: decision.request_id,
    adapter: publicAdapterKey(decision.selected_network),
    fallback_available: Boolean(decision.fallback_available),
    ad_format: decision.ad_format || "rewarded",
    config: {
      placement_id: config.network_placement_id,
      script_url: config.sdk_script_url,
      global_name: config.sdk_global_name,
      sdk: config.client_config.sdk,
    },
  };
}
