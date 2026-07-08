"use client";

import { RICHADS_PRODUCTION_PLACEMENT, type MiniAppAdFormat, type MiniAppNetworkName, type MiniAppSdkErrorCode } from "@/lib/miniappNetworkAdapters";

const ADSGALAXY_BOT_URL = `https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME || "Ads_Galaxy_bot"}`;

type NetworkClientConfig = {
  network_name: MiniAppNetworkName;
  network_placement_id: string;
  client_config?: {
    network_name: MiniAppNetworkName;
    network_placement_id: string;
    ad_format_support?: Record<MiniAppAdFormat, boolean>;
      sdk?: {
        script_url?: string | null;
        global_name?: string | null;
        backup_script_url?: string | null;
        script_timeout_ms?: number;
        request_timeout_ms?: number;
        richads_publisher_id?: string;
        richads_app_id?: string;
        richads_placement_type?: typeof RICHADS_PRODUCTION_PLACEMENT;
        test_mode?: boolean;
        debug?: boolean;
        id?: number;
        title?: string;
        description?: string;
        cta_text?: string;
        title_color?: string | null;
        body_color?: string | null;
        image_url?: string | null;
        advertiser_logo_url?: string | null;
        logo_url?: string | null;
        landing_url?: string;
        admin_cpm?: number;
    };
  };
};

type MediationResponse = {
  success?: boolean;
  request_id?: string;
  selected_network?: MiniAppNetworkName;
  network_placement_id?: string;
  fallback_available?: boolean;
  error_code?: string;
  message?: string;
  error?: string;
  monetag_protection?: { reason?: string };
  internal_ad?: InternalAdPayload | null;
};

export type InternalAdPayload = {
  id: number;
  title: string;
  description: string;
  cta_text?: string;
  title_color?: string | null;
  body_color?: string | null;
  image_url?: string | null;
  advertiser_logo_url?: string | null;
  logo_url?: string | null;
  landing_url: string;
  admin_cpm?: number;
};

export type MediationRequestInput = {
  miniapp_id: number;
  telegram_user_id: string | number;
  country?: string;
  ad_format?: MiniAppAdFormat;
  initData: string;
  gross_revenue?: number;
  timeout_ms?: number;
};
export type MiniAppRewardedAdInput = Omit<MediationRequestInput, "ad_format">;

export type MiniAppSdkResult = {
  success: boolean;
  network: MiniAppNetworkName | null;
  request_id?: string;
  error_code?: MiniAppSdkErrorCode;
  error_message?: string;
  raw_result?: unknown;
  reward_eligible?: boolean;
  status?: string;
  diagnostics?: Record<string, unknown>;
};

type AdapterRequest = {
  config: NetworkClientConfig;
  request_id: string;
  telegram_user_id: string;
  timeout_ms?: number;
  internal_lifecycle?: InternalAdLifecycle;
};

type InternalAdQualityEvent = {
  event_type: "impression_recorded" | "watch_update" | "completed" | "app_minimized" | "app_backgrounded" | "session_abandoned" | "ad_abandoned";
  watch_duration_seconds: number;
  completed?: boolean;
  abandonment_reason?: string;
};

type InternalAdLifecycle = {
  onImpression?: (event: InternalAdQualityEvent) => Promise<unknown>;
  onQualityEvent?: (event: InternalAdQualityEvent) => Promise<unknown>;
  onAdClick?: () => Promise<string | null>;
};

type RuntimeAdapter = {
  network_name: MiniAppNetworkName;
  validateConfig: (config: NetworkClientConfig) => MiniAppSdkResult;
  loadSdk: (config: NetworkClientConfig, timeoutMs?: number) => Promise<MiniAppSdkResult>;
  requestRewardedAd: (input: AdapterRequest) => Promise<MiniAppSdkResult>;
  requestInterstitialAd: (input: AdapterRequest) => Promise<MiniAppSdkResult>;
  requestBannerAd: (input: AdapterRequest) => Promise<MiniAppSdkResult>;
};

type MonetagModule = {
  default: (zoneId: number) => (options?: string | Record<string, unknown>) => Promise<unknown>;
};

declare global {
  interface Window {
    Adsgram?: { init: (config: { blockId: string }) => { show: () => Promise<unknown> } };
    AdexiumWidget?: new (config: Record<string, unknown>) => {
      requestAd: (format: string) => void;
      displayAd: (ad: unknown) => void;
      on: (eventName: string, handler: (payload?: unknown) => void) => void;
      off?: (eventName: string, handler: (payload?: unknown) => void) => void;
    };
    TelegramAdsController?: new () => {
      initialize: (config: { pubId: string; appId: string; debug?: boolean }) => void;
      triggerInterstitialVideo: () => Promise<unknown>;
    };
    showGiga?: () => Promise<unknown>;
  }
}

const sdkLoads = new Map<string, Promise<void>>();
let monetagModulePromise: Promise<MonetagModule> | null = null;

function networkLog(network: MiniAppNetworkName, event: string, details: Record<string, unknown> = {}) {
  console.info("[AdsGalaxy network]", { network, event, ...details });
}

function errorResult(network: MiniAppNetworkName | null, errorCode: MiniAppSdkErrorCode, errorMessage: string): MiniAppSdkResult {
  return { success: false, network, error_code: errorCode, error_message: errorMessage };
}

function friendlySdkMessage(errorCode?: string, fallback = "Unable to load this advertisement. Please try again.") {
  if (errorCode === "NO_FILL" || errorCode === "AD_UNAVAILABLE") {
    return "No advertisements are available at the moment. Please try again shortly.";
  }
  if (errorCode === "TIMEOUT" || errorCode === "NETWORK_ERROR" || errorCode === "SDK_LOAD_FAILED") {
    return "Network temporarily unavailable.";
  }
  return fallback;
}

function withFriendlyError(result: MiniAppSdkResult): MiniAppSdkResult {
  if (result.success) return result;
  return { ...result, error_message: friendlySdkMessage(result.error_code) };
}

function validateLoadedSdk(config: NetworkClientConfig) {
  const sdk = config.client_config?.sdk || {};
  const checks: Array<{ name: string; passed: boolean; reason?: string }> = [];
  const check = (name: string, passed: boolean, reason?: string) => checks.push({ name, passed, ...(reason ? { reason } : {}) });

  if (config.network_name === "AdsGalaxyInternal") {
    check("internal_renderer_available", true);
  } else if (config.network_name === "AdsGram") {
    check("global_object_available", Boolean(window.Adsgram), "window.Adsgram is missing");
    check("init_method_available", typeof window.Adsgram?.init === "function", "window.Adsgram.init is missing");
  } else if (config.network_name === "GigaPub") {
    check("display_method_available", typeof window.showGiga === "function", "window.showGiga is missing");
  } else if (config.network_name === "AdExium") {
    const available = typeof window.AdexiumWidget === "function";
    check("widget_constructor_available", available, "window.AdexiumWidget is missing");
    if (available) {
      try {
        const widget = new window.AdexiumWidget!({ wid: config.network_placement_id, adFormat: "interstitial", debug: true });
        check("callback_registration_available", typeof widget.on === "function", "widget.on is missing");
        check("request_method_available", typeof widget.requestAd === "function", "widget.requestAd is missing");
        check("render_method_available", typeof widget.displayAd === "function", "widget.displayAd is missing");
        try {
          if (typeof (widget as unknown as { destroy?: () => void }).destroy === "function") {
            (widget as unknown as { destroy: () => void }).destroy();
          }
        } catch {
          // Cleanup best effort only for isolated diagnostics.
        }
      } catch (error) {
        check("widget_instantiation_available", false, error instanceof Error ? error.message : "AdExium widget could not be constructed");
      }
    }
  } else if (config.network_name === "Monetag") {
    const globalName = sdk.global_name || `show_${config.network_placement_id}`;
    check("zone_global_available", typeof window[globalName as keyof Window] === "function", `${globalName} is missing`);
  } else if (config.network_name === "RichAds") {
    const available = typeof window.TelegramAdsController === "function";
    check("controller_constructor_available", available, "window.TelegramAdsController is missing");
    if (available) {
      try {
        const controller = new window.TelegramAdsController!();
        check("initialize_method_available", typeof controller.initialize === "function", "initialize is missing");
        check("interstitial_method_available", typeof controller.triggerInterstitialVideo === "function", "triggerInterstitialVideo is missing");
      } catch (error) {
        check("controller_instantiation_available", false, error instanceof Error ? error.message : "RichAds controller could not be constructed");
      }
    }
  }

  const failed = checks.find((item) => !item.passed);
  return {
    success: !failed,
    checks,
    failure_reason: failed?.reason || null,
  };
}

function successResult(network: MiniAppNetworkName, requestId: string, rawResult?: unknown): MiniAppSdkResult {
  return { success: true, network, request_id: requestId, raw_result: rawResult };
}

function isRetryableSdkError(errorCode: string | undefined) {
  return errorCode === "SDK_LOAD_FAILED"
    || errorCode === "AD_UNAVAILABLE"
    || errorCode === "TIMEOUT"
    || errorCode === "INVALID_CONFIG"
    || errorCode === "NETWORK_ERROR"
    || errorCode === "SDK_UNAVAILABLE"
    || errorCode === "SDK_NOT_CONFIGURED"
    || errorCode === "INVALID_RESPONSE"
    || errorCode === "RENDER_FAILED"
    || errorCode === "NO_FILL";
}

function sdkErrorReason(error: MiniAppSdkResult) {
  return error.error_message || error.error_code || "Network failed";
}

function timeout<T>(promise: Promise<T>, timeoutMs: number, message = "Ad request timed out") {
  let timer: number | undefined;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== undefined) window.clearTimeout(timer);
  });
}

function providerTimeoutMs(config: NetworkClientConfig, requestedTimeoutMs?: number) {
  return requestedTimeoutMs || config.client_config?.sdk?.request_timeout_ms || 30000;
}

function loadScriptOnce(src: string, options: { globalName?: string | null; timeoutMs?: number; attrs?: Record<string, string> } = {}) {
  const key = `${src}:${JSON.stringify(options.attrs || {})}`;
  const timeoutMs = options.timeoutMs || 15000;

  if (options.globalName && typeof window[options.globalName as keyof Window] !== "undefined") {
    return Promise.resolve();
  }

  if (sdkLoads.has(key)) {
    return sdkLoads.get(key)!;
  }

  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-miniapp-sdk-key="${CSS.escape(key)}"]`);
    if (existing?.dataset.loaded === "true") {
      resolve();
      return;
    }

    const script = existing || document.createElement("script");
    const timer = window.setTimeout(() => {
      sdkLoads.delete(key);
      if (!existing) script.remove();
      reject(new Error("SDK load timed out"));
    }, timeoutMs);

    script.dataset.miniappSdkKey = key;
    script.async = true;
    script.src = src;

    Object.entries(options.attrs || {}).forEach(([name, value]) => {
      script.setAttribute(name, value);
    });

    script.addEventListener("load", () => {
      window.clearTimeout(timer);
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });

    script.addEventListener("error", () => {
      window.clearTimeout(timer);
      sdkLoads.delete(key);
      reject(new Error("SDK script failed to load"));
    }, { once: true });

    if (!existing) {
      document.head.appendChild(script);
    }
  });

  sdkLoads.set(key, promise);
  return promise;
}

async function loadGigaPubScript(projectId: string, config: NetworkClientConfig, timeoutMs?: number) {
  const sdk = config.client_config?.sdk || {};
  const scriptTimeout = sdk.script_timeout_ms || 15000;
  const bases = [
    sdk.script_url || "https://ad.gigapub.tech/script",
    sdk.backup_script_url || "https://ru-ad.gigapub.tech/script",
  ].filter(Boolean) as string[];
  const errors: string[] = [];

  for (const base of bases) {
    const url = `${base}${base.includes("?") ? "&" : "?"}id=${encodeURIComponent(projectId)}`;
    try {
      await loadScriptOnce(url, {
        globalName: null,
        timeoutMs: scriptTimeout,
        attrs: {
          "data-network": "GigaPub",
          "data-project-id": projectId,
        },
      });
      if (typeof window.showGiga === "function") return;
      errors.push(`${base} loaded without window.showGiga`);
    } catch (error: any) {
      errors.push(error?.message || `${base} failed`);
    }
  }

  throw new Error(errors.join("; ") || "GigaPub SDK failed to load");
}

function assertPlacement(config: NetworkClientConfig): MiniAppSdkResult {
  if (!config.network_placement_id?.trim()) {
    return errorResult(config.network_name, "INVALID_CONFIG", `${config.network_name} placement ID is missing`);
  }

  return { success: true, network: config.network_name };
}

function unsupported(network: MiniAppNetworkName, format: MiniAppAdFormat) {
  return errorResult(network, "UNSUPPORTED_FORMAT", `${network} does not support ${format} ads in this adapter`);
}

function notImplemented(network: MiniAppNetworkName, message: string) {
  return errorResult(network, "NOT_IMPLEMENTED", message);
}

const adsGramAdapter: RuntimeAdapter = {
  network_name: "AdsGram",
  validateConfig: assertPlacement,
  async loadSdk(config, timeoutMs) {
    const validation = assertPlacement(config);
    if (!validation.success) return validation;

    try {
      networkLog("AdsGram", "request_started", { phase: "sdk_load" });
      await loadScriptOnce(config.client_config?.sdk?.script_url || "https://sad.adsgram.ai/js/sad.min.js", {
        globalName: "Adsgram",
        timeoutMs,
      });

      if (!window.Adsgram?.init) {
        networkLog("AdsGram", "failed", { phase: "sdk_load", code: "SDK_LOAD_FAILED" });
        return errorResult("AdsGram", "SDK_LOAD_FAILED", "AdsGram SDK loaded without window.Adsgram.init");
      }

      networkLog("AdsGram", "initialized");
      return { success: true, network: "AdsGram" };
    } catch (error: any) {
      return errorResult("AdsGram", error?.message?.includes("timed out") ? "TIMEOUT" : "SDK_LOAD_FAILED", error?.message || "Failed to load AdsGram SDK");
    }
  },
  async requestRewardedAd({ config, request_id, timeout_ms }) {
    const loaded = await this.loadSdk(config, timeout_ms);
    if (!loaded.success) return loaded;

    try {
      const controller = window.Adsgram!.init({ blockId: config.network_placement_id });
      const result = await timeout(controller.show(), providerTimeoutMs(config, timeout_ms));
      return successResult("AdsGram", request_id, result);
    } catch (error: any) {
      return errorResult("AdsGram", error?.message?.includes("timed out") ? "TIMEOUT" : "AD_UNAVAILABLE", error?.message || "AdsGram ad was not completed");
    }
  },
  requestInterstitialAd(input) {
    return this.requestRewardedAd(input);
  },
  async requestBannerAd() {
    return unsupported("AdsGram", "banner");
  },
};

const monetagAdapter: RuntimeAdapter = {
  network_name: "Monetag",
  validateConfig(config) {
    const validation = assertPlacement(config);
    if (!validation.success) return validation;

    const zoneId = Number(config.network_placement_id);
    if (!Number.isInteger(zoneId) || zoneId <= 0) {
      return errorResult("Monetag", "INVALID_CONFIG", "Monetag Zone ID must be a positive number");
    }

    return { success: true, network: "Monetag" };
  },
  async loadSdk(config) {
    const validation = this.validateConfig(config);
    if (!validation.success) return validation;

    try {
      networkLog("Monetag", "request_started", { phase: "sdk_load", test_mode: Boolean(config.client_config?.sdk?.test_mode) });
      monetagModulePromise ||= import("monetag-tg-sdk") as Promise<MonetagModule>;
      const monetagModule = await monetagModulePromise;
      monetagModule.default(Number(config.network_placement_id));
      networkLog("Monetag", "initialized", { test_mode: Boolean(config.client_config?.sdk?.test_mode) });
      return { success: true, network: "Monetag" };
    } catch (error: any) {
      return errorResult("Monetag", "SDK_LOAD_FAILED", error?.message || "Failed to load Monetag SDK");
    }
  },
  async requestRewardedAd({ config, request_id, timeout_ms }) {
    const loaded = await this.loadSdk(config, timeout_ms);
    if (!loaded.success) return loaded;

    try {
      const monetagModule = await monetagModulePromise!;
      const handler = monetagModule.default(Number(config.network_placement_id));
      const requestTimeout = providerTimeoutMs(config, timeout_ms);
      const result = await timeout(handler({ type: "end", timeout: Math.ceil(requestTimeout / 1000) }), requestTimeout);
      return successResult("Monetag", request_id, result);
    } catch (error: any) {
      return errorResult("Monetag", error?.message?.includes("timed out") ? "TIMEOUT" : "AD_UNAVAILABLE", error?.message || "Monetag ad was not completed");
    }
  },
  requestInterstitialAd(input) {
    return this.requestRewardedAd(input);
  },
  async requestBannerAd() {
    return unsupported("Monetag", "banner");
  },
};

const adExiumAdapter: RuntimeAdapter = {
  network_name: "AdExium",
  validateConfig: assertPlacement,
  async loadSdk(config, timeoutMs) {
    const validation = assertPlacement(config);
    if (!validation.success) return validation;

    try {
      await loadScriptOnce(config.client_config?.sdk?.script_url || "https://cdn.techtg.space/assets/js/tg-ads-co-widget.min.js", {
        globalName: "AdexiumWidget",
        timeoutMs,
      });

      if (!window.AdexiumWidget) {
        return errorResult("AdExium", "SDK_LOAD_FAILED", "AdExium SDK loaded without AdexiumWidget");
      }

      return { success: true, network: "AdExium" };
    } catch (error: any) {
      return errorResult("AdExium", error?.message?.includes("timed out") ? "TIMEOUT" : "SDK_LOAD_FAILED", error?.message || "Failed to load AdExium SDK");
    }
  },
  async requestRewardedAd() {
    return notImplemented("AdExium", "AdExium rewarded SDK wiring is not implemented because the existing adapter only has interstitial widget events.");
  },
  async requestInterstitialAd({ config, request_id, timeout_ms }) {
    const loaded = await this.loadSdk(config, timeout_ms);
    if (!loaded.success) return loaded;

    try {
      const widget = new window.AdexiumWidget!({
        wid: config.network_placement_id,
        adFormat: "interstitial",
        debug: Boolean(config.client_config?.sdk?.debug),
      });

      const result = await timeout(new Promise<unknown>((resolve, reject) => {
        const onAdReceived = (ad?: unknown) => {
          widget.off?.("adReceived", onAdReceived);
          widget.off?.("noAdFound", onNoAdFound);
          try {
            widget.displayAd(ad);
            resolve(ad);
          } catch (error: any) {
            networkLog("AdExium", "failed", { reason: "render_failed", error: error?.message || "displayAd failed" });
            const renderError = new Error(error?.message || "AdExium render failed") as Error & { code?: MiniAppSdkErrorCode };
            renderError.code = "RENDER_FAILED";
            reject(renderError);
          }
        };
        const onNoAdFound = () => {
          widget.off?.("adReceived", onAdReceived);
          widget.off?.("noAdFound", onNoAdFound);
          reject(new Error("AdExium returned no ad"));
        };

        widget.on("adReceived", onAdReceived);
        widget.on("noAdFound", onNoAdFound);
        widget.requestAd("interstitial");
      }), providerTimeoutMs(config, timeout_ms));

      return successResult("AdExium", request_id, result);
    } catch (error: any) {
      if (error?.code === "RENDER_FAILED") {
        return errorResult("AdExium", "RENDER_FAILED", error?.message || "AdExium render failed");
      }
      return errorResult("AdExium", error?.message?.includes("timed out") ? "TIMEOUT" : "AD_UNAVAILABLE", error?.message || "AdExium ad was not available");
    }
  },
  async requestBannerAd() {
    return unsupported("AdExium", "banner");
  },
};

const richAdsAdapter: RuntimeAdapter = {
  network_name: "RichAds",
  validateConfig(config) {
    const placement = assertPlacement(config);
    if (!placement.success) return placement;

    if (!config.client_config?.sdk?.richads_publisher_id) {
      return errorResult("RichAds", "INVALID_CONFIG", "RichAds publisher ID is missing from server config");
    }
    if (!config.client_config?.sdk?.richads_app_id) {
      return errorResult("RichAds", "INVALID_CONFIG", "RichAds App ID is missing from server config");
    }
    if (config.client_config?.sdk?.richads_placement_type !== RICHADS_PRODUCTION_PLACEMENT) {
      return errorResult("RichAds", "INVALID_CONFIG", "RichAds placement must be Telegram Interstitial Video");
    }

    return { success: true, network: "RichAds" };
  },
  async loadSdk(config, timeoutMs) {
    const validation = this.validateConfig(config);
    if (!validation.success) return validation;

    try {
      await loadScriptOnce(config.client_config?.sdk?.script_url || "https://richinfo.co/richpartners/telegram/js/tg-ob.js", {
        globalName: "TelegramAdsController",
        timeoutMs,
      });

      if (!window.TelegramAdsController) {
        return errorResult("RichAds", "SDK_LOAD_FAILED", "RichAds SDK loaded without TelegramAdsController");
      }

      return { success: true, network: "RichAds" };
    } catch (error: any) {
      return errorResult("RichAds", error?.message?.includes("timed out") ? "TIMEOUT" : "SDK_LOAD_FAILED", error?.message || "Failed to load RichAds SDK");
    }
  },
  async requestRewardedAd({ config, request_id, timeout_ms }) {
    const loaded = await this.loadSdk(config, timeout_ms);
    if (!loaded.success) return loaded;

    try {
      // Current production placement: RichAds Telegram Interstitial Video only.
      // Future RichAds formats must receive separate explicit adapter methods.
      const controller = new window.TelegramAdsController!();
      controller.initialize({
        pubId: config.client_config!.sdk!.richads_publisher_id!,
        appId: config.client_config!.sdk!.richads_app_id!,
        debug: Boolean(config.client_config?.sdk?.debug),
      });
      const result = await timeout(controller.triggerInterstitialVideo(), providerTimeoutMs(config, timeout_ms));
      return successResult("RichAds", request_id, result);
    } catch (error: any) {
      return errorResult("RichAds", error?.message?.includes("timed out") ? "TIMEOUT" : "AD_UNAVAILABLE", error?.message || "RichAds video ad was not available");
    }
  },
  async requestInterstitialAd() {
    return unsupported("RichAds", "interstitial");
  },
  async requestBannerAd() {
    return unsupported("RichAds", "banner");
  },
};

const gigaPubAdapter: RuntimeAdapter = {
  network_name: "GigaPub",
  validateConfig: assertPlacement,
  async loadSdk(config, timeoutMs) {
    const validation = assertPlacement(config);
    if (!validation.success) return validation;

    try {
      await loadGigaPubScript(config.network_placement_id, config, timeoutMs);
      if (typeof window.showGiga !== "function") {
        return errorResult("GigaPub", "SDK_LOAD_FAILED", "GigaPub SDK loaded without window.showGiga");
      }
      return { success: true, network: "GigaPub" };
    } catch (error: any) {
      return errorResult("GigaPub", error?.message?.includes("timed out") ? "TIMEOUT" : "SDK_LOAD_FAILED", error?.message || "Failed to load GigaPub SDK");
    }
  },
  async requestRewardedAd({ config, request_id, timeout_ms }) {
    const loaded = await this.loadSdk(config, timeout_ms);
    if (!loaded.success) return loaded;

    try {
      if (typeof window.showGiga !== "function") {
        return errorResult("GigaPub", "SDK_LOAD_FAILED", "GigaPub showGiga is unavailable");
      }
      const result = await timeout(window.showGiga(), providerTimeoutMs(config, timeout_ms));
      return successResult("GigaPub", request_id, result);
    } catch (error: any) {
      const message = error?.message || "GigaPub ad was not available";
      const lower = message.toLowerCase();
      const code = lower.includes("timed out")
        ? "TIMEOUT"
        : lower.includes("no fill") || lower.includes("nofill") || lower.includes("no ad")
          ? "NO_FILL"
          : "AD_UNAVAILABLE";
      return errorResult("GigaPub", code, message);
    }
  },
  requestInterstitialAd(input) {
    return this.requestRewardedAd(input);
  },
  async requestBannerAd() {
    return unsupported("GigaPub", "banner");
  },
};

const runtimeAdapters: Record<MiniAppNetworkName, RuntimeAdapter> = {
  AdsGram: adsGramAdapter,
  Monetag: monetagAdapter,
  AdExium: adExiumAdapter,
  RichAds: richAdsAdapter,
  GigaPub: gigaPubAdapter,
  AdsGalaxyInternal: {
    network_name: "AdsGalaxyInternal",
    validateConfig: assertPlacement,
    async loadSdk() {
      return { success: true, network: "AdsGalaxyInternal" };
    },
    async requestRewardedAd({ request_id, config, internal_lifecycle }) {
      const ad = config.client_config?.sdk as unknown as InternalAdPayload | undefined;
      if (!ad?.title || !ad.landing_url) {
        return errorResult("AdsGalaxyInternal", "INVALID_CONFIG", "Internal ad payload is missing");
      }

      try {
        await showInternalRewardedAd(ad, internal_lifecycle);
        return successResult("AdsGalaxyInternal", request_id, ad);
      } catch (error: any) {
        return errorResult(
          "AdsGalaxyInternal",
          "USER_CLOSED",
          error?.message || "Internal rewarded ad was dismissed"
        );
      }
    },
    async requestInterstitialAd() {
      return unsupported("AdsGalaxyInternal", "interstitial");
    },
    async requestBannerAd() {
      return unsupported("AdsGalaxyInternal", "banner");
    },
  },
};

async function confirmImpression(input: MediationRequestInput, selectedNetwork: MiniAppNetworkName, requestId: string) {
  if (selectedNetwork === "AdsGalaxyInternal") {
    return confirmInternalImpression(input, requestId, {
      event_type: "impression_recorded",
      watch_duration_seconds: 1.5,
    });
  }

  const response = await fetch("/api/miniapp/mediation/impression", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-telegram-init-data": input.initData,
    },
    body: JSON.stringify({
      request_id: requestId,
      miniapp_id: input.miniapp_id,
      network_name: selectedNetwork,
      telegram_user_id: input.telegram_user_id,
      country: input.country,
      // External SDKs currently confirm display, not payout. Keep revenue zero unless
      // a real network value is supplied by a future server-to-server postback/import.
      gross_revenue: input.gross_revenue || 0,
      revenue_source: input.gross_revenue ? "client_supplied" : "pending_postback_or_import",
      revenue_note: "Client-confirmed external impressions can record gross_revenue = 0; reporting revenue remains zero until real network postback/import is implemented.",
      impressions: 1,
    }), signal: AbortSignal.timeout(12000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Failed to confirm Mini App impression");
  }

  return data;
}

async function confirmInternalImpression(input: MediationRequestInput, requestId: string, quality?: Partial<InternalAdQualityEvent>) {
  const response = await fetch("/api/miniapp/internal-ads/impression", {
    method: "POST",
    keepalive: true,
    headers: {
      "Content-Type": "application/json",
      "x-telegram-init-data": input.initData,
    },
    body: JSON.stringify({
      request_id: requestId,
      miniapp_id: input.miniapp_id,
      telegram_user_id: input.telegram_user_id,
      event_type: quality?.event_type || "impression_recorded",
      watch_duration_seconds: quality?.watch_duration_seconds ?? 1.5,
      completed: Boolean(quality?.completed),
      abandonment_reason: quality?.abandonment_reason,
    }), signal: AbortSignal.timeout(12000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Failed to confirm internal ad impression");
  }

  return data;
}

function showInternalRewardedAd(ad: InternalAdPayload, lifecycle?: InternalAdLifecycle) {
  return new Promise<void>((resolve) => {
    const startedAt = Date.now();
    const maxSeconds = 15;
    const previousBodyOverflow = document.body.style.overflow;
    let overlayClosed = false;
    let completionNotified = false;
    let impressionSent = false;
    let lastQualityEvent = "";
    // These timers are assigned after the DOM nodes they update are created.
    // eslint-disable-next-line prefer-const
    let countdownTimer: number | undefined;
    // eslint-disable-next-line prefer-const
    let completionTimer: number | undefined;
    // eslint-disable-next-line prefer-const
    let impressionTimer: number | undefined;
    let autoCloseTimer: number | undefined;

    const elapsedSeconds = () => Math.min(maxSeconds, (Date.now() - startedAt) / 1000);
    const sendQualityEvent = (event: InternalAdQualityEvent) => {
      const eventKey = `${event.event_type}:${Math.floor(event.watch_duration_seconds)}`;
      if (eventKey === lastQualityEvent && event.event_type !== "completed") return;
      lastQualityEvent = eventKey;
      lifecycle?.onQualityEvent?.(event).catch(() => undefined);
    };
    const openTrackedLanding = async () => {
      try {
        const trackedUrl = await lifecycle?.onAdClick?.();
        window.open(trackedUrl || ad.landing_url, "_blank", "noopener,noreferrer");
      } catch {
        window.open(ad.landing_url, "_blank", "noopener,noreferrer");
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden" && !overlayClosed && !completionNotified) {
        sendQualityEvent({ event_type: "app_backgrounded", watch_duration_seconds: elapsedSeconds(), abandonment_reason: "app_backgrounded" });
      }
    };
    const onBlur = () => {
      if (!overlayClosed && !completionNotified && elapsedSeconds() < maxSeconds) {
        sendQualityEvent({ event_type: "app_minimized", watch_duration_seconds: elapsedSeconds(), abandonment_reason: "app_minimized" });
      }
    };
    const onPageHide = () => {
      if (!overlayClosed && !completionNotified) {
        sendQualityEvent({ event_type: "session_abandoned", watch_duration_seconds: elapsedSeconds(), abandonment_reason: "session_abandoned" });
      }
    };
    const cleanup = () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pagehide", onPageHide);
      if (countdownTimer !== undefined) window.clearInterval(countdownTimer);
      if (completionTimer !== undefined) window.clearTimeout(completionTimer);
      if (impressionTimer !== undefined) window.clearTimeout(impressionTimer);
      if (autoCloseTimer !== undefined) window.clearTimeout(autoCloseTimer);
    };

    const displayTitle = String(ad.title || "").trim().slice(0, 50);
    const displayDescription = String(ad.description || "").trim().slice(0, 200);
    const displayCta = String(ad.cta_text || "Learn More").trim().slice(0, 24) || "Learn More";
    const defaultLogoUrl = new URL("/logo.svg", window.location.origin).toString();
    const logoUrl = String(ad.advertiser_logo_url || ad.logo_url || defaultLogoUrl).trim();
    const overlay = document.createElement("div");
    overlay.className = "agx-rewarded-overlay";
    const style = document.createElement("style");
    style.textContent = `
      .agx-rewarded-overlay{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:calc(env(safe-area-inset-top) + 18px) max(18px,env(safe-area-inset-right)) calc(env(safe-area-inset-bottom) + 18px) max(18px,env(safe-area-inset-left));font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f8fafc;background:radial-gradient(circle at 22% 8%,rgba(99,102,241,.34),transparent 24%),radial-gradient(circle at 82% 16%,rgba(34,211,238,.18),transparent 24%),linear-gradient(180deg,#020617 0%,#07101e 48%,#020617 100%);animation:agxRewardedFade .18s ease-out;overflow:hidden}
      .agx-rewarded-overlay:before{content:"";position:absolute;inset:0;background-image:radial-gradient(circle,rgba(255,255,255,.2) 0 1px,transparent 1.5px),radial-gradient(circle,rgba(125,211,252,.16) 0 1px,transparent 1.4px);background-size:92px 92px,137px 137px;background-position:12px 18px,48px 60px;opacity:.34;pointer-events:none}
      .agx-rewarded-overlay:after{content:"";position:absolute;inset:0;background:linear-gradient(115deg,transparent 0 24%,rgba(255,255,255,.045) 36%,transparent 50% 100%);pointer-events:none}
      .agx-rewarded-card{position:relative;z-index:1;width:min(520px,92vw);max-height:calc(100dvh - 36px);overflow:auto;border-radius:24px;padding:18px 18px 14px;background:linear-gradient(180deg,rgba(17,24,39,.98),rgba(5,11,23,.98));border:1px solid rgba(203,213,225,.16);box-shadow:0 30px 100px rgba(0,0,0,.66),0 0 0 1px rgba(99,102,241,.08),0 0 48px rgba(79,70,229,.2),inset 0 1px 0 rgba(255,255,255,.08);text-align:center;animation:agxRewardedPop .24s cubic-bezier(.2,.8,.2,1);overscroll-behavior:contain}
      .agx-rewarded-top{position:relative;display:flex;align-items:center;justify-content:center;min-height:36px;margin-bottom:12px}
      .agx-rewarded-heading{font-size:18px;line-height:1.1;font-weight:900;color:#f8fafc}
      .agx-rewarded-close{position:absolute;right:0;top:50%;width:36px;height:36px;transform:translateY(-50%);border-radius:999px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#fff;display:none;align-items:center;justify-content:center;font-size:28px;line-height:1;font-weight:300;box-shadow:0 10px 24px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.12);cursor:pointer;transition:background .16s ease}
      .agx-rewarded-close[hidden]{display:none}
      .agx-rewarded-close:hover{background:rgba(255,255,255,.14)}
      .agx-rewarded-media{display:block;width:min(100%,420px);aspect-ratio:1/1;max-height:min(45dvh,420px);margin:0 auto;border-radius:18px;background:transparent;border:0;box-shadow:none;overflow:hidden;cursor:pointer}
      .agx-rewarded-hero{display:block;width:100%;height:100%;max-height:min(45dvh,420px);object-fit:cover;background:transparent}
      .agx-rewarded-placeholder{display:flex;min-height:150px;width:100%;height:100%;align-items:center;justify-content:center;flex-direction:column;gap:8px;background:linear-gradient(135deg,#0f172a,#1e3a8a 54%,#0ea5e9);color:#fff;font-weight:950;letter-spacing:0;text-align:center}
      .agx-rewarded-placeholder-mark{position:relative;width:52px;height:52px;border-radius:16px;background:rgba(255,255,255,.13);box-shadow:inset 0 1px 0 rgba(255,255,255,.2)}
      .agx-rewarded-placeholder-mark:before{content:"";position:absolute;inset:14px;border:4px solid #fff;border-right-color:transparent;border-radius:999px;transform:rotate(-24deg)}
      .agx-rewarded-placeholder-text{font-size:15px}
      .agx-rewarded-body{padding:16px 0 0;text-align:center}
      .agx-rewarded-advertiser{display:flex;align-items:center;justify-content:center;margin-bottom:10px}
      .agx-rewarded-logo{width:34px;height:34px;border-radius:10px;object-fit:cover;border:1px solid rgba(255,255,255,.16);background:#0f172a}
      .agx-rewarded-title{margin:0 auto 8px;max-width:100%;font-size:21px;line-height:1.2;font-weight:950;color:#fff;overflow-wrap:anywhere}
      .agx-rewarded-desc{margin:0 auto 16px;width:min(100%,420px);max-width:100%;color:#b9c3d5;font-size:14px;line-height:1.45;font-weight:650;overflow-wrap:anywhere}
      .agx-rewarded-cta{width:100%;min-height:52px;border:0;border-radius:15px;background:linear-gradient(135deg,#5b5cff 0%,#2563eb 52%,#14b8a6 100%);color:#fff;font-size:16px;font-weight:950;padding:14px 18px;cursor:pointer;box-shadow:0 16px 34px rgba(37,99,235,.34),inset 0 1px 0 rgba(255,255,255,.18);transition:transform .16s ease,filter .16s ease}
      .agx-rewarded-cta:hover{transform:translateY(-1px);filter:saturate(1.08)}
      .agx-rewarded-sponsored{display:flex;align-items:center;justify-content:center;gap:9px;margin:18px 0 14px;padding-top:14px;border-top:1px solid rgba(148,163,184,.12);text-decoration:none;font-size:14px;font-weight:800;color:#818ca1}
      .agx-rewarded-mark{position:relative;display:inline-flex;width:28px;height:28px;border-radius:999px;align-items:center;justify-content:center;background:conic-gradient(from 140deg,#22d3ee,#5b5cff,#8b5cf6,#22d3ee);box-shadow:0 0 22px rgba(91,92,255,.26)}
      .agx-rewarded-mark:before{content:"";position:absolute;inset:6px;border:2px solid rgba(255,255,255,.88);border-right-color:transparent;border-radius:999px;transform:rotate(-22deg)}
      .agx-rewarded-mark:after{content:"";position:absolute;width:5px;height:5px;border-radius:999px;background:#fff;box-shadow:0 0 10px rgba(255,255,255,.7);transform:translate(8px,-7px)}
      .agx-rewarded-sponsored strong{color:#7477ff}
      .agx-rewarded-countdown{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid rgba(148,163,184,.18);border-radius:16px;background:rgba(15,23,42,.48);padding:12px 14px 12px 16px}
      .agx-rewarded-countdown[hidden]{display:none}
      .agx-rewarded-countdown-label{display:flex;align-items:center;gap:10px;color:#9aa5b8;font-size:15px;font-weight:800}
      .agx-rewarded-clock{width:24px;height:24px;color:#8791a5;flex:0 0 auto}
      .agx-rewarded-ring-wrap{position:relative;width:50px;height:50px;flex:0 0 auto}
      .agx-rewarded-ring{width:50px;height:50px;transform:rotate(-90deg)}
      .agx-rewarded-ring circle{fill:none;stroke-width:5}
      .agx-rewarded-ring-track{stroke:rgba(148,163,184,.18)}
      .agx-rewarded-ring-progress{stroke:#5b5cff;stroke-linecap:round;transition:stroke-dashoffset .28s linear}
      .agx-rewarded-ring-text{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:17px;font-weight:950;font-variant-numeric:tabular-nums}
      .agx-rewarded-watermark{margin-top:12px;color:rgba(203,213,225,.48);font-size:12px;font-weight:800}
      .agx-rewarded-close:focus-visible,.agx-rewarded-cta:focus-visible,.agx-rewarded-sponsored:focus-visible{outline:3px solid rgba(96,165,250,.55);outline-offset:3px}
      @keyframes agxRewardedFade{from{opacity:0}to{opacity:1}}
      @keyframes agxRewardedPop{from{opacity:0;transform:translate3d(0,10px,0) scale(.975)}to{opacity:1;transform:translate3d(0,0,0) scale(1)}}
      @media (orientation:landscape) and (max-height:560px){.agx-rewarded-card{width:min(640px,92vw);max-height:calc(100dvh - 24px);padding:14px}.agx-rewarded-media,.agx-rewarded-hero{max-height:40dvh}.agx-rewarded-body{padding-top:10px}.agx-rewarded-desc{margin-bottom:10px}.agx-rewarded-sponsored{margin:12px 0 10px}}
      @media (max-width:380px){.agx-rewarded-overlay{padding:14px}.agx-rewarded-card{border-radius:22px;padding:14px}.agx-rewarded-media{border-radius:16px}.agx-rewarded-title{font-size:19px}.agx-rewarded-desc{font-size:13px}.agx-rewarded-countdown-label{font-size:14px}.agx-rewarded-ring-wrap,.agx-rewarded-ring{width:46px;height:46px}}
    `;

    const panel = document.createElement("div");
    panel.className = "agx-rewarded-card";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Sponsored ad");
    const header = document.createElement("div");
    header.className = "agx-rewarded-top";
    const heading = document.createElement("div");
    heading.className = "agx-rewarded-heading";
    heading.textContent = "Ads";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "x";
    close.setAttribute("aria-label", "Close ad");
    close.disabled = true;
    close.hidden = true;
    close.className = "agx-rewarded-close";
    header.append(heading, close);
    panel.appendChild(header);

    if (ad.image_url) {
      const media = document.createElement("div");
      media.className = "agx-rewarded-media";
      media.onclick = () => openTrackedLanding();
      const image = document.createElement("img");
      image.src = ad.image_url;
      image.alt = displayTitle;
      image.loading = "eager";
      image.decoding = "async";
      image.className = "agx-rewarded-hero";
      image.onerror = () => {
        image.remove();
        const placeholder = document.createElement("div");
        placeholder.className = "agx-rewarded-placeholder";
        placeholder.setAttribute("aria-label", "AdsGalaxy ad creative");
        placeholder.innerHTML = `<span class="agx-rewarded-placeholder-mark" aria-hidden="true"></span><span class="agx-rewarded-placeholder-text">AdsGalaxy</span>`;
        media.appendChild(placeholder);
      };
      media.appendChild(image);
      panel.appendChild(media);
    }

    const body = document.createElement("div");
    body.className = "agx-rewarded-body";
    const advertiser = document.createElement("div");
    advertiser.className = "agx-rewarded-advertiser";
    const logo = document.createElement("img");
    logo.src = logoUrl;
    logo.alt = "";
    logo.className = "agx-rewarded-logo";
    logo.onerror = () => {
      if (logo.src !== defaultLogoUrl) logo.src = defaultLogoUrl;
    };
    advertiser.appendChild(logo);
    body.appendChild(advertiser);
    const title = document.createElement("div");
    title.textContent = displayTitle;
    title.className = "agx-rewarded-title";
    if (ad.title_color) title.style.color = ad.title_color;
    const description = document.createElement("div");
    description.textContent = displayDescription;
    description.className = "agx-rewarded-desc";
    if (ad.body_color) description.style.color = ad.body_color;
    const cta = document.createElement("button");
    cta.type = "button";
    cta.textContent = displayCta;
    cta.className = "agx-rewarded-cta";
    cta.onclick = () => openTrackedLanding();
    body.append(title, description, cta);
    panel.appendChild(body);

    const attribution = document.createElement("a");
    attribution.href = ADSGALAXY_BOT_URL;
    attribution.target = "_blank";
    attribution.rel = "noopener noreferrer";
    attribution.className = "agx-rewarded-sponsored";
    attribution.innerHTML = `<span class="agx-rewarded-mark" aria-hidden="true"></span><span>Sponsored by</span><strong>AdsGalaxy</strong>`;
    const countdownBox = document.createElement("div");
    countdownBox.className = "agx-rewarded-countdown";
    const countdownLabel = document.createElement("div");
    countdownLabel.className = "agx-rewarded-countdown-label";
    countdownLabel.innerHTML = `<svg class="agx-rewarded-clock" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v6l4 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Skip in <strong>15s</strong></span>`;
    const ringWrap = document.createElement("div");
    ringWrap.className = "agx-rewarded-ring-wrap";
    ringWrap.innerHTML = `<svg class="agx-rewarded-ring" viewBox="0 0 48 48" aria-hidden="true"><circle class="agx-rewarded-ring-track" cx="24" cy="24" r="20"></circle><circle class="agx-rewarded-ring-progress" cx="24" cy="24" r="20"></circle></svg><span class="agx-rewarded-ring-text">15</span>`;
    const ringProgress = ringWrap.querySelector<SVGCircleElement>(".agx-rewarded-ring-progress")!;
    const ringText = ringWrap.querySelector<HTMLElement>(".agx-rewarded-ring-text")!;
    const ringLength = 2 * Math.PI * 20;
    ringProgress.style.strokeDasharray = `${ringLength}`;
    ringProgress.style.strokeDashoffset = "0";
    countdownBox.append(countdownLabel, ringWrap);
    const watermark = document.createElement("div");
    watermark.className = "agx-rewarded-watermark";
    watermark.textContent = "@Ads_Galaxy_bot";
    panel.append(attribution, countdownBox, watermark);
    overlay.append(style, panel);
    document.body.style.overflow = "hidden";
    document.body.appendChild(overlay);

    const closeOverlay = () => {
      if (overlayClosed) return;
      overlayClosed = true;
      cleanup();
      document.body.style.overflow = previousBodyOverflow;
      overlay.remove();
    };
    const completeCountdown = () => {
      if (completionNotified) return;
      completionNotified = true;
      sendQualityEvent({ event_type: "completed", watch_duration_seconds: maxSeconds, completed: true });
      if (countdownTimer !== undefined) window.clearInterval(countdownTimer);
      countdownLabel.innerHTML = `<svg class="agx-rewarded-clock" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v6l4 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Skip in <strong>0s</strong></span>`;
      ringText.textContent = "0";
      ringProgress.style.strokeDashoffset = `${ringLength}`;
      close.hidden = false;
      close.disabled = false;
      resolve();
      autoCloseTimer = window.setTimeout(closeOverlay, 2000);
    };

    impressionTimer = window.setTimeout(() => {
      impressionSent = true;
      lifecycle?.onImpression?.({ event_type: "impression_recorded", watch_duration_seconds: 1.5 }).catch(() => undefined);
    }, 1500);
    countdownTimer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil(maxSeconds - elapsedSeconds()));
      const elapsed = Math.min(maxSeconds, elapsedSeconds());
      countdownLabel.innerHTML = `<svg class="agx-rewarded-clock" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v6l4 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Skip in <strong>${remaining}s</strong></span>`;
      ringText.textContent = String(remaining);
      ringProgress.style.strokeDashoffset = `${ringLength * (elapsed / maxSeconds)}`;
      if (remaining <= 0) {
        completeCountdown();
      } else if (impressionSent && remaining % 5 === 0) {
        sendQualityEvent({ event_type: "watch_update", watch_duration_seconds: elapsedSeconds() });
      }
    }, 250);
    completionTimer = window.setTimeout(completeCountdown, maxSeconds * 1000);

    close.onclick = closeOverlay;
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pagehide", onPageHide);
  });
}

export function previewInternalRewardedAd(ad: InternalAdPayload) {
  return showInternalRewardedAd(ad);
}

export function getMiniAppRuntimeAdapter(networkName: MiniAppNetworkName) {
  return runtimeAdapters[networkName];
}

export async function testMiniAppNetworkInitialization(config: NetworkClientConfig, timeoutMs = 15000): Promise<MiniAppSdkResult> {
  const adapter = runtimeAdapters[config.network_name];
  if (!adapter) return errorResult(null, "INVALID_CONFIG", "Unsupported ad network.");

  const startedAt = Date.now();
  const consoleErrors: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" ").slice(0, 300));
    originalConsoleError(...args);
  };
  networkLog(config.network_name, "test_started", { test_mode: true });
  try {
    const result = await adapter.loadSdk(config, timeoutMs);
    const sdkValidation = result.success ? validateLoadedSdk(config) : { success: false, checks: [], failure_reason: result.error_message || result.error_code || null };
    const durationMs = Date.now() - startedAt;
    networkLog(config.network_name, result.success && sdkValidation.success ? "initialized" : "failed", {
      test_mode: true,
      error_code: result.error_code,
      duration_ms: durationMs,
      sdk_validation: sdkValidation,
      console_error_count: consoleErrors.length,
    });
    if (!result.success) {
      return withFriendlyError({
        ...result,
        diagnostics: { duration_ms: durationMs, sdk_validation: sdkValidation, console_errors: consoleErrors },
      });
    }
    if (!sdkValidation.success) {
      return withFriendlyError(errorResult(config.network_name, "SDK_UNAVAILABLE", sdkValidation.failure_reason || "SDK loaded but required methods are unavailable"));
    }
    return {
      ...result,
      diagnostics: {
        duration_ms: durationMs,
        sdk_validation: sdkValidation,
        console_errors: consoleErrors,
        render_status: "not_requested",
        impression_status: "not_recorded_test_mode",
        completion_status: "not_recorded_test_mode",
      },
    };
  } finally {
    console.error = originalConsoleError;
  }
}

export async function requestMiniAppAd(input: MediationRequestInput): Promise<MiniAppSdkResult> {
  const adFormat = input.ad_format || "rewarded";
  const mediationResponse = await fetch("/api/miniapp/mediation/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-telegram-init-data": input.initData,
    },
    body: JSON.stringify({
      miniapp_id: input.miniapp_id,
      telegram_user_id: input.telegram_user_id,
      country: input.country,
      ad_format: adFormat,
    }), signal: AbortSignal.timeout(12000),
  });

  const mediation = await mediationResponse.json().catch(() => ({}));
  if (!mediationResponse.ok || mediation.success === false) {
    const locked = mediation.monetag_protection?.reason === "locked";
    const errorCode = mediation.error_code === "NO_FILL" ? "NO_FILL" : locked ? "MONETAG_LOCKED" : "REQUEST_FAILED";
    return errorResult(
      null,
      errorCode,
      friendlySdkMessage(errorCode)
    );
  }

  let currentDecision = mediation as MediationResponse;

  while (currentDecision.success !== false && currentDecision.selected_network && currentDecision.request_id) {
    const selectedNetwork = currentDecision.selected_network;
    const internalNetworkConfig = selectedNetwork === "AdsGalaxyInternal"
      ? {
          network_name: "AdsGalaxyInternal" as MiniAppNetworkName,
          network_placement_id: String(currentDecision.internal_ad?.id || ""),
          client_config: {
            network_name: "AdsGalaxyInternal" as MiniAppNetworkName,
            network_placement_id: String(currentDecision.internal_ad?.id || ""),
            sdk: currentDecision.internal_ad || undefined,
          },
        }
      : null;

    if (internalNetworkConfig) {
      const adapter = runtimeAdapters[selectedNetwork];
      let internalImpressionConfirmed = false;
      const sendInternalQuality = async (event: InternalAdQualityEvent) => {
        await confirmInternalImpression(input, currentDecision.request_id!, event);
      };
      const adResult = await adapter.requestRewardedAd({
        config: internalNetworkConfig,
        request_id: currentDecision.request_id,
        telegram_user_id: String(input.telegram_user_id),
        timeout_ms: input.timeout_ms,
        internal_lifecycle: {
          onImpression: async (event) => {
            internalImpressionConfirmed = true;
            await sendInternalQuality(event);
          },
          onQualityEvent: sendInternalQuality,
          onAdClick: async () => {
            const response = await fetch("/api/conversions/click", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-telegram-init-data": input.initData,
              },
              body: JSON.stringify({
                campaign_type: "miniapp",
                campaign_id: currentDecision.internal_ad?.id,
                miniapp_id: input.miniapp_id,
                request_id: currentDecision.request_id,
                session_id: String(input.telegram_user_id),
              }),
            });
            const data = await response.json().catch(() => ({}));
            return response.ok ? data.url || null : null;
          },
        },
      });

      if (!adResult.success) {
        if (!isRetryableSdkError(adResult.error_code) || !currentDecision.fallback_available) return withFriendlyError(adResult);
        currentDecision = await requestFallback(input, currentDecision, adResult.error_code || "NETWORK_ERROR", adResult.error_message || "Network failed");
        continue;
      }

      try {
        await confirmInternalImpression(input, currentDecision.request_id, {
          event_type: "completed",
          watch_duration_seconds: 15,
          completed: true,
        });
        internalImpressionConfirmed = true;
        return adResult;
      } catch {
        if (internalImpressionConfirmed) return adResult;
        return errorResult(selectedNetwork, "IMPRESSION_FAILED", friendlySdkMessage("NETWORK_ERROR"));
      }
    }

    const configResponse = await fetch(`/api/miniapp/mediation/config?miniapp_id=${input.miniapp_id}&network_name=${encodeURIComponent(selectedNetwork)}`, {
      headers: { "x-telegram-init-data": input.initData }, signal: AbortSignal.timeout(12000),
    });
    const configData = await configResponse.json().catch(() => ({}));
    if (!configResponse.ok || !configData.networks?.[0]) {
      currentDecision = await requestFallback(input, currentDecision, "INVALID_CONFIG", configData.error || "Selected network config is unavailable");
      continue;
    }

    const adapter = runtimeAdapters[selectedNetwork];
    const networkConfig = configData.networks[0] as NetworkClientConfig;
    const validation = adapter.validateConfig(networkConfig);
    if (!validation.success) {
      currentDecision = await requestFallback(input, currentDecision, validation.error_code || "INVALID_CONFIG", validation.error_message || "Invalid network config");
      continue;
    }

    const requestInput = {
      config: networkConfig,
      request_id: currentDecision.request_id,
      telegram_user_id: String(input.telegram_user_id),
      timeout_ms: input.timeout_ms,
    };

    const providerStartedAt = Date.now();
    networkLog(selectedNetwork, "request_started", {
      request_id: currentDecision.request_id,
      ad_format: adFormat,
      timeout_ms: providerTimeoutMs(networkConfig, input.timeout_ms),
    });
    const adResult = adFormat === "banner"
      ? await adapter.requestBannerAd(requestInput)
      : adFormat === "interstitial"
        ? await adapter.requestInterstitialAd(requestInput)
        : await adapter.requestRewardedAd(requestInput);
    const providerDurationMs = Date.now() - providerStartedAt;

    if (!adResult.success) {
      networkLog(selectedNetwork, "failed", {
        request_id: currentDecision.request_id,
        duration_ms: providerDurationMs,
        result: adResult.error_code || "NETWORK_ERROR",
        reason: sdkErrorReason(adResult),
        timeout: adResult.error_code === "TIMEOUT",
        no_fill: adResult.error_code === "NO_FILL",
      });
      if (!isRetryableSdkError(adResult.error_code) || !currentDecision.fallback_available) {
        return withFriendlyError(adResult);
      }

      currentDecision = await requestFallback(
        input,
        currentDecision,
        adResult.error_code || "NETWORK_ERROR",
        sdkErrorReason(adResult),
        {
          started_at: new Date(providerStartedAt).toISOString(),
          finished_at: new Date().toISOString(),
          duration_ms: providerDurationMs,
        }
      );
      continue;
    }

    try {
      const confirmation = await confirmImpression(input, selectedNetwork, currentDecision.request_id);
      networkLog(selectedNetwork, "completed", {
        request_id: currentDecision.request_id,
        duration_ms: providerDurationMs,
        result: "render_success",
        impression_success: true,
        completion_success: Boolean(confirmation?.reward_eligible),
      });
      return {
        ...adResult,
        reward_eligible: Boolean(confirmation?.reward_eligible),
        status: String(confirmation?.status || "pending_provider_confirmation"),
      };
    } catch {
      return errorResult(selectedNetwork, "IMPRESSION_FAILED", friendlySdkMessage("NETWORK_ERROR"));
    }
  }

  const finalErrorCode = currentDecision.error_code === "NO_FILL" ? "NO_FILL" : "REQUEST_FAILED";
  return errorResult(
    null,
    finalErrorCode,
    friendlySdkMessage(finalErrorCode)
  );
}

export function requestMiniAppRewardedAd(input: MiniAppRewardedAdInput): Promise<MiniAppSdkResult> {
  return requestMiniAppAd({
    ...input,
    ad_format: "rewarded",
  });
}

async function requestFallback(
  input: MediationRequestInput,
  decision: MediationResponse,
  errorCode: string,
  errorMessage: string,
  diagnostics: { started_at?: string; finished_at?: string; duration_ms?: number } = {}
): Promise<MediationResponse> {
  if (!decision.request_id || !decision.selected_network) {
    return { success: false, error_code: "NO_FILL", message: "No advertisements are available at the moment. Please try again shortly." };
  }

  const response = await fetch("/api/miniapp/mediation/fallback", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-telegram-init-data": input.initData,
    },
    body: JSON.stringify({
      request_id: decision.request_id,
      failed_network: decision.selected_network,
      error_code: errorCode,
      error_message: errorMessage,
      ...diagnostics,
    }), signal: AbortSignal.timeout(12000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorCode = data.error_code || "REQUEST_FAILED";
    return {
      success: false,
      error_code: errorCode,
      message: friendlySdkMessage(errorCode),
    };
  }

  return data;
}
