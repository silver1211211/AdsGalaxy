"use client";

import type { MiniAppAdFormat, MiniAppNetworkName, MiniAppSdkErrorCode } from "@/lib/miniappNetworkAdapters";

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
      richads_publisher_id?: string;
      id?: number;
      title?: string;
      description?: string;
      image_url?: string | null;
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

type InternalAdPayload = {
  id: number;
  title: string;
  description: string;
  image_url?: string | null;
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
};

type AdapterRequest = {
  config: NetworkClientConfig;
  request_id: string;
  telegram_user_id: string;
  timeout_ms?: number;
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
      triggerInterstitialBanner: () => Promise<unknown>;
      triggerNativeNotification: () => Promise<unknown>;
    };
  }
}

const sdkLoads = new Map<string, Promise<void>>();
let monetagModulePromise: Promise<MonetagModule> | null = null;

function errorResult(network: MiniAppNetworkName | null, errorCode: MiniAppSdkErrorCode, errorMessage: string): MiniAppSdkResult {
  return { success: false, network, error_code: errorCode, error_message: errorMessage };
}

function successResult(network: MiniAppNetworkName, requestId: string, rawResult?: unknown): MiniAppSdkResult {
  return { success: true, network, request_id: requestId, raw_result: rawResult };
}

function isRetryableSdkError(errorCode: string | undefined) {
  return errorCode === "SDK_LOAD_FAILED"
    || errorCode === "AD_UNAVAILABLE"
    || errorCode === "TIMEOUT"
    || errorCode === "INVALID_CONFIG"
    || errorCode === "NETWORK_ERROR";
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
    const timer = window.setTimeout(() => reject(new Error("SDK load timed out")), timeoutMs);

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
      await loadScriptOnce(config.client_config?.sdk?.script_url || "https://sad.adsgram.ai/js/sad.min.js", {
        globalName: "Adsgram",
        timeoutMs,
      });

      if (!window.Adsgram?.init) {
        return errorResult("AdsGram", "SDK_LOAD_FAILED", "AdsGram SDK loaded without window.Adsgram.init");
      }

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
      const result = await timeout(controller.show(), timeout_ms || 30000);
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
      monetagModulePromise ||= import("monetag-tg-sdk") as Promise<MonetagModule>;
      await monetagModulePromise;
      return { success: true, network: "Monetag" };
    } catch (error: any) {
      return errorResult("Monetag", "SDK_LOAD_FAILED", error?.message || "Failed to load Monetag SDK");
    }
  },
  async requestRewardedAd({ config, request_id, timeout_ms }) {
    const loaded = await this.loadSdk(config, timeout_ms);
    if (!loaded.success) return loaded;

    try {
      const module = await monetagModulePromise!;
      const handler = module.default(Number(config.network_placement_id));
      const result = await timeout(handler({ type: "end", timeout: Math.ceil((timeout_ms || 30000) / 1000) }), timeout_ms || 30000);
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
        debug: false,
      });

      const result = await timeout(new Promise<unknown>((resolve, reject) => {
        const onAdReceived = (ad?: unknown) => {
          widget.off?.("adReceived", onAdReceived);
          widget.off?.("noAdFound", onNoAdFound);
          widget.displayAd(ad);
          resolve(ad);
        };
        const onNoAdFound = () => {
          widget.off?.("adReceived", onAdReceived);
          widget.off?.("noAdFound", onNoAdFound);
          reject(new Error("AdExium returned no ad"));
        };

        widget.on("adReceived", onAdReceived);
        widget.on("noAdFound", onNoAdFound);
        widget.requestAd("interstitial");
      }), timeout_ms || 30000);

      return successResult("AdExium", request_id, result);
    } catch (error: any) {
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
      const controller = new window.TelegramAdsController!();
      controller.initialize({
        pubId: config.client_config!.sdk!.richads_publisher_id!,
        appId: config.network_placement_id,
        debug: false,
      });
      const result = await timeout(controller.triggerInterstitialVideo(), timeout_ms || 30000);
      return successResult("RichAds", request_id, result);
    } catch (error: any) {
      return errorResult("RichAds", error?.message?.includes("timed out") ? "TIMEOUT" : "AD_UNAVAILABLE", error?.message || "RichAds video ad was not available");
    }
  },
  async requestInterstitialAd({ config, request_id, timeout_ms }) {
    const loaded = await this.loadSdk(config, timeout_ms);
    if (!loaded.success) return loaded;

    try {
      const controller = new window.TelegramAdsController!();
      controller.initialize({
        pubId: config.client_config!.sdk!.richads_publisher_id!,
        appId: config.network_placement_id,
        debug: false,
      });
      const result = await timeout(controller.triggerInterstitialBanner(), timeout_ms || 30000);
      return successResult("RichAds", request_id, result);
    } catch (error: any) {
      return errorResult("RichAds", error?.message?.includes("timed out") ? "TIMEOUT" : "AD_UNAVAILABLE", error?.message || "RichAds interstitial ad was not available");
    }
  },
  async requestBannerAd() {
    return unsupported("RichAds", "banner");
  },
};

const runtimeAdapters: Record<MiniAppNetworkName, RuntimeAdapter> = {
  AdsGram: adsGramAdapter,
  Monetag: monetagAdapter,
  AdExium: adExiumAdapter,
  RichAds: richAdsAdapter,
  AdsGalaxyInternal: {
    network_name: "AdsGalaxyInternal",
    validateConfig: assertPlacement,
    async loadSdk() {
      return { success: true, network: "AdsGalaxyInternal" };
    },
    async requestRewardedAd({ request_id, config }) {
      const ad = config.client_config?.sdk as unknown as InternalAdPayload | undefined;
      if (!ad?.title || !ad.landing_url) {
        return errorResult("AdsGalaxyInternal", "INVALID_CONFIG", "Internal ad payload is missing");
      }

      try {
        await showInternalRewardedAd(ad);
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
    return confirmInternalImpression(input, requestId);
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
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Failed to confirm Mini App impression");
  }

  return data;
}

async function confirmInternalImpression(input: MediationRequestInput, requestId: string) {
  const response = await fetch("/api/miniapp/internal-ads/impression", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-telegram-init-data": input.initData,
    },
    body: JSON.stringify({
      request_id: requestId,
      miniapp_id: input.miniapp_id,
      telegram_user_id: input.telegram_user_id,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Failed to confirm internal ad impression");
  }

  return data;
}

function showInternalRewardedAd(ad: InternalAdPayload) {
  return new Promise<void>((resolve, reject) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.72);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
    const panel = document.createElement("div");
    panel.style.cssText = "width:min(420px,100%);background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 24px 80px rgba(15,23,42,.35);border:1px solid #e2e8f0;";

    if (ad.image_url) {
      const image = document.createElement("img");
      image.src = ad.image_url;
      image.alt = ad.title;
      image.style.cssText = "display:block;width:100%;height:180px;object-fit:cover;background:#f1f5f9;";
      panel.appendChild(image);
    }

    const body = document.createElement("div");
    body.style.cssText = "padding:16px;";
    const title = document.createElement("div");
    title.textContent = ad.title;
    title.style.cssText = "font-size:16px;font-weight:800;color:#0f172a;margin-bottom:8px;";
    const description = document.createElement("div");
    description.textContent = ad.description;
    description.style.cssText = "font-size:13px;line-height:1.45;color:#475569;margin-bottom:16px;";
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;";
    const visit = document.createElement("button");
    visit.textContent = "Open";
    visit.style.cssText = "flex:1;border:0;border-radius:8px;background:#2563eb;color:#fff;font-size:13px;font-weight:700;padding:10px;cursor:pointer;";
    const close = document.createElement("button");
    close.textContent = "Done";
    close.style.cssText = "flex:1;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;font-size:13px;font-weight:700;padding:10px;cursor:pointer;";

    visit.onclick = () => {
      window.open(ad.landing_url, "_blank", "noopener,noreferrer");
    };
    close.onclick = () => {
      overlay.remove();
      resolve();
    };
    overlay.onclick = (event) => {
      if (event.target === overlay) {
        overlay.remove();
        reject(new Error("Internal rewarded ad was dismissed"));
      }
    };

    actions.append(visit, close);
    body.append(title, description, actions);
    panel.appendChild(body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  });
}

export function getMiniAppRuntimeAdapter(networkName: MiniAppNetworkName) {
  return runtimeAdapters[networkName];
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
    }),
  });

  const mediation = await mediationResponse.json().catch(() => ({}));
  if (!mediationResponse.ok || mediation.success === false) {
    const locked = mediation.monetag_protection?.reason === "locked";
    return errorResult(
      null,
      mediation.error_code === "NO_FILL" ? "NO_FILL" : locked ? "MONETAG_LOCKED" : "REQUEST_FAILED",
      mediation.message || mediation.error || "Failed to request Mini App mediation"
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
      const adResult = await adapter.requestRewardedAd({
        config: internalNetworkConfig,
        request_id: currentDecision.request_id,
        telegram_user_id: String(input.telegram_user_id),
        timeout_ms: input.timeout_ms,
      });

      if (!adResult.success) {
        if (!isRetryableSdkError(adResult.error_code) || !currentDecision.fallback_available) return adResult;
        currentDecision = await requestFallback(input, currentDecision, adResult.error_code || "NETWORK_ERROR", adResult.error_message || "Network failed");
        continue;
      }

      try {
        await confirmImpression(input, selectedNetwork, currentDecision.request_id);
        return adResult;
      } catch (error: any) {
        return errorResult(selectedNetwork, "IMPRESSION_FAILED", error?.message || "Ad displayed but impression confirmation failed");
      }
    }

    const configResponse = await fetch(`/api/miniapp/mediation/config?miniapp_id=${input.miniapp_id}&network_name=${encodeURIComponent(selectedNetwork)}`, {
      headers: { "x-telegram-init-data": input.initData },
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

    const adResult = adFormat === "banner"
      ? await adapter.requestBannerAd(requestInput)
      : adFormat === "interstitial"
        ? await adapter.requestInterstitialAd(requestInput)
        : await adapter.requestRewardedAd(requestInput);

    if (!adResult.success) {
      if (!isRetryableSdkError(adResult.error_code) || !currentDecision.fallback_available) {
        return adResult;
      }

      currentDecision = await requestFallback(
        input,
        currentDecision,
        adResult.error_code || "NETWORK_ERROR",
        adResult.error_message || "Network failed"
      );
      continue;
    }

    try {
      await confirmImpression(input, selectedNetwork, currentDecision.request_id);
      return adResult;
    } catch (error: any) {
      return errorResult(selectedNetwork, "IMPRESSION_FAILED", error?.message || "Ad displayed but impression confirmation failed");
    }
  }

  return errorResult(
    null,
    currentDecision.error_code === "NO_FILL" ? "NO_FILL" : "REQUEST_FAILED",
    currentDecision.message || currentDecision.error || "No ad available right now."
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
  errorMessage: string
): Promise<MediationResponse> {
  if (!decision.request_id || !decision.selected_network) {
    return { success: false, error_code: "NO_FILL", message: "No ad available right now." };
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
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      success: false,
      error_code: data.error_code || "REQUEST_FAILED",
      message: data.error || data.message || "Failed to request fallback network",
    };
  }

  return data;
}
