export const MINIAPP_NETWORKS = ["AdsGram", "Monetag", "RichAds", "AdExium", "GigaPub", "AdsGalaxyInternal"] as const;
export type MiniAppNetworkName = typeof MINIAPP_NETWORKS[number];
export type MiniAppAdFormat = "rewarded" | "banner" | "interstitial";
export const RICHADS_PRODUCTION_PLACEMENT = "telegram_interstitial_video" as const;

export type MiniAppSdkErrorCode =
  | "SDK_LOAD_FAILED"
  | "INVALID_CONFIG"
  | "NETWORK_DISABLED"
  | "MONETAG_LOCKED"
  | "AD_UNAVAILABLE"
  | "TIMEOUT"
  | "UNSUPPORTED_FORMAT"
  | "NOT_IMPLEMENTED"
  | "SDK_NOT_CONFIGURED"
  | "USER_CLOSED"
  | "NETWORK_ERROR"
  | "NO_FILL"
  | "REQUEST_FAILED"
  | "IMPRESSION_FAILED";

export type MiniAppNetworkAdapter = {
  network_name: MiniAppNetworkName;
  required_id_label: string;
  supports_rewarded: boolean;
  supports_banner: boolean;
  supports_interstitial: boolean;
  client_config_shape: {
    network_name: MiniAppNetworkName;
    placement_id_key: string;
    network_placement_id: string;
    ad_format_support: {
      rewarded: boolean;
      banner: boolean;
      interstitial: boolean;
    };
    sdk: {
      script_url: string | null;
      global_name: string | null;
      placement_id_key: string;
      richads_publisher_id?: string;
      richads_app_id?: string;
      richads_placement_type?: typeof RICHADS_PRODUCTION_PLACEMENT;
      backup_script_url?: string | null;
      script_timeout_ms?: number;
    };
  };
  validateConfig: (networkPlacementId: string) => { valid: boolean; error?: string };
  loadSdk: "browser";
  requestRewardedAd: "browser";
  requestInterstitialAd: "browser";
  requestBannerAd: "browser";
};

const gigaPubPrimaryOrigin = process.env.GIGAPUB_PRIMARY_ORIGIN || process.env.NEXT_PUBLIC_GIGAPUB_PRIMARY_ORIGIN || "https://ad.gigapub.tech";
const gigaPubBackupOrigin = process.env.GIGAPUB_BACKUP_ORIGIN || process.env.NEXT_PUBLIC_GIGAPUB_BACKUP_ORIGIN || "https://ru-ad.gigapub.tech";

const adapterDefinitions: Record<
  MiniAppNetworkName,
  Omit<
    MiniAppNetworkAdapter,
    "client_config_shape" | "validateConfig" | "loadSdk" | "requestRewardedAd" | "requestInterstitialAd" | "requestBannerAd"
  > & {
    placement_id_key: string;
    sdk_script_url: string | null;
    sdk_global_name: string | null;
    validateConfig?: (networkPlacementId: string) => { valid: boolean; error?: string };
  }
> = {
  AdsGram: {
    network_name: "AdsGram",
    required_id_label: "Placement ID",
    supports_rewarded: true,
    supports_banner: false,
    supports_interstitial: true,
    placement_id_key: "placement_id",
    sdk_script_url: "https://sad.adsgram.ai/js/sad.min.js",
    sdk_global_name: "Adsgram",
  },
  Monetag: {
    network_name: "Monetag",
    required_id_label: "Zone ID",
    supports_rewarded: true,
    supports_banner: false,
    supports_interstitial: true,
    placement_id_key: "zone_id",
    sdk_script_url: null,
    sdk_global_name: null,
  },
  AdExium: {
    network_name: "AdExium",
    required_id_label: "App ID",
    supports_rewarded: false,
    supports_banner: false,
    supports_interstitial: true,
    placement_id_key: "app_id",
    sdk_script_url: "https://cdn.techtg.space/assets/js/tg-ads-co-widget.min.js",
    sdk_global_name: "AdexiumWidget",
  },
  RichAds: {
    network_name: "RichAds",
    required_id_label: "Widget ID",
    supports_rewarded: true,
    supports_banner: false,
    // Production RichAds traffic is intentionally restricted to Telegram Interstitial Video.
    // Add future RichAds placements as explicit adapter capabilities; never silently reuse this placement.
    supports_interstitial: false,
    placement_id_key: "widget_id",
    sdk_script_url: "https://richinfo.co/richpartners/telegram/js/tg-ob.js",
    sdk_global_name: "TelegramAdsController",
    validateConfig: (networkPlacementId) => {
      if (!networkPlacementId.trim()) {
        return { valid: false, error: "Missing App ID" };
      }
      return { valid: true };
    },
  },
  GigaPub: {
    network_name: "GigaPub",
    required_id_label: "Project ID",
    supports_rewarded: true,
    supports_banner: false,
    supports_interstitial: true,
    placement_id_key: "project_id",
    sdk_script_url: `${gigaPubPrimaryOrigin}/script`,
    sdk_global_name: "showGiga",
    validateConfig: (networkPlacementId) => {
      if (!networkPlacementId.trim()) {
        return { valid: false, error: "GigaPub requires Project ID" };
      }
      return { valid: true };
    },
  },
  AdsGalaxyInternal: {
    network_name: "AdsGalaxyInternal",
    required_id_label: "Internal Campaign",
    supports_rewarded: true,
    supports_banner: false,
    supports_interstitial: false,
    placement_id_key: "campaign_id",
    sdk_script_url: null,
    sdk_global_name: null,
  },
};

export function isMiniAppNetworkName(value: string): value is MiniAppNetworkName {
  return MINIAPP_NETWORKS.includes(value as MiniAppNetworkName);
}

export function getMiniAppNetworkAdapter(networkName: MiniAppNetworkName) {
  const adapter = adapterDefinitions[networkName];
  const validateConfig = adapter.validateConfig || ((networkPlacementId: string) => {
    if (!networkPlacementId.trim()) {
      return { valid: false, error: `${adapter.network_name} requires ${adapter.required_id_label}` };
    }
    return { valid: true };
  });

  return {
    network_name: adapter.network_name,
    required_id_label: adapter.required_id_label,
    supports_rewarded: adapter.supports_rewarded,
    supports_banner: adapter.supports_banner,
    supports_interstitial: adapter.supports_interstitial,
    validateConfig,
    loadSdk: "browser",
    requestRewardedAd: "browser",
    requestInterstitialAd: "browser",
    requestBannerAd: "browser",
    client_config_shape: {
      network_name: adapter.network_name,
      placement_id_key: adapter.placement_id_key,
      network_placement_id: "",
      ad_format_support: {
        rewarded: adapter.supports_rewarded,
        banner: adapter.supports_banner,
        interstitial: adapter.supports_interstitial,
      },
      sdk: {
        script_url: adapter.sdk_script_url,
        global_name: adapter.sdk_global_name,
        placement_id_key: adapter.placement_id_key,
        ...(adapter.network_name === "GigaPub" ? {
          backup_script_url: `${gigaPubBackupOrigin}/script`,
          script_timeout_ms: 15000,
        } : {}),
      },
    },
  } satisfies MiniAppNetworkAdapter;
}

export function buildMiniAppNetworkClientConfig(networkName: MiniAppNetworkName, networkPlacementId: string, richAds?: { publisherId?: string | null; appId?: string | null }) {
  const adapter = getMiniAppNetworkAdapter(networkName);
  const normalizedPlacementId = (networkName === "RichAds" ? richAds?.appId : networkPlacementId)?.trim() || "";
  const validation = adapter.validateConfig(normalizedPlacementId);

  if (!validation.valid) {
    throw new Error(validation.error || `${adapter.network_name} configuration is invalid`);
  }
  if (networkName === "RichAds" && !richAds?.publisherId?.trim()) throw new Error("Missing Publisher ID");

  return {
    network_name: adapter.network_name,
    required_id_label: adapter.required_id_label,
    network_placement_id: normalizedPlacementId,
    client_config: {
      ...adapter.client_config_shape,
      network_placement_id: normalizedPlacementId,
      sdk: {
        ...adapter.client_config_shape.sdk,
        ...(networkName === "RichAds" ? {
          richads_publisher_id: richAds!.publisherId!.trim(),
          richads_app_id: normalizedPlacementId,
          richads_placement_type: RICHADS_PRODUCTION_PLACEMENT,
        } : {}),
      },
    },
    sdk_script_url: adapter.client_config_shape.sdk.script_url,
    sdk_global_name: adapter.client_config_shape.sdk.global_name,
    supports_rewarded: adapter.supports_rewarded,
    supports_banner: adapter.supports_banner,
    supports_interstitial: adapter.supports_interstitial,
  };
}
