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
        richads_publisher_id?: string;
        richads_app_id?: string;
        richads_placement_type?: typeof RICHADS_PRODUCTION_PLACEMENT;
        id?: number;
        title?: string;
        description?: string;
        cta_text?: string;
        title_color?: string | null;
        body_color?: string | null;
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
  cta_text?: string;
  title_color?: string | null;
  body_color?: string | null;
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
  reward_eligible?: boolean;
  status?: string;
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
    || errorCode === "NETWORK_ERROR"
    || errorCode === "NO_FILL";
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
      });
      const result = await timeout(controller.triggerInterstitialVideo(), timeout_ms || 30000);
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
      const result = await timeout(window.showGiga(), timeout_ms || 30000);
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
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;
    let impressionSent = false;
    let lastQualityEvent = "";
    const maxSeconds = 15;

    const elapsedSeconds = () => Math.min(maxSeconds, (Date.now() - startedAt) / 1000);
    const openTrackedLanding = async () => {
      try {
        const trackedUrl = await lifecycle?.onAdClick?.();
        window.open(trackedUrl || ad.landing_url, "_blank", "noopener,noreferrer");
      } catch {
        window.open(ad.landing_url, "_blank", "noopener,noreferrer");
      }
    };
    const sendQualityEvent = (event: InternalAdQualityEvent) => {
      const eventKey = `${event.event_type}:${Math.floor(event.watch_duration_seconds)}`;
      if (eventKey === lastQualityEvent && event.event_type !== "completed") return;
      lastQualityEvent = eventKey;
      lifecycle?.onQualityEvent?.(event).catch(() => undefined);
    };
    const cleanup = () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pagehide", onPageHide);
      window.clearInterval(countdownTimer);
      if (impressionTimer !== undefined) window.clearTimeout(impressionTimer);
    };
    const complete = () => {
      if (settled) return;
      settled = true;
      sendQualityEvent({ event_type: "completed", watch_duration_seconds: maxSeconds, completed: true });
      cleanup();
      overlay.remove();
      resolve();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden" && !settled) {
        sendQualityEvent({
          event_type: "app_backgrounded",
          watch_duration_seconds: elapsedSeconds(),
          abandonment_reason: "app_backgrounded",
        });
      }
    };
    const onBlur = () => {
      if (!settled && elapsedSeconds() < maxSeconds) {
        sendQualityEvent({
          event_type: "app_minimized",
          watch_duration_seconds: elapsedSeconds(),
          abandonment_reason: "app_minimized",
        });
      }
    };
    const onPageHide = () => {
      if (!settled) {
        sendQualityEvent({
          event_type: "session_abandoned",
          watch_duration_seconds: elapsedSeconds(),
          abandonment_reason: "session_abandoned",
        });
      }
    };

    const displayTitle = String(ad.title || "").trim().slice(0, 40);
    const displayDescription = String(ad.description || "").trim().slice(0, 120);
    const displayCta = String(ad.cta_text || "Learn More").trim().slice(0, 40) || "Learn More";
    const overlay = document.createElement("div");
    overlay.className = "agx-rewarded-overlay";
    const style = document.createElement("style");
    style.textContent = `
      .agx-rewarded-overlay{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:calc(max(6vh,env(safe-area-inset-top)) + 12px) max(16px,env(safe-area-inset-right)) calc(max(6vh,env(safe-area-inset-bottom)) + 12px) max(16px,env(safe-area-inset-left));font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:radial-gradient(circle at 50% 0%,rgba(96,165,250,.18),transparent 32%),rgba(2,6,23,.82);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);animation:agxRewardedFade .18s ease-out}
      .agx-rewarded-card{position:relative;width:min(420px,100%);max-height:calc(100dvh - max(12vh,96px));overflow:auto;border-radius:32px;padding:16px;color:#f8fafc;background:linear-gradient(180deg,rgba(15,23,42,.96),rgba(2,6,23,.98));border:1px solid rgba(255,255,255,.14);box-shadow:0 32px 90px rgba(0,0,0,.48),0 14px 44px rgba(37,99,235,.18);text-align:left;animation:agxRewardedPop .24s cubic-bezier(.2,.8,.2,1);overscroll-behavior:contain}
      .agx-rewarded-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
      .agx-rewarded-brand{min-width:0;color:#94a3b8;font-size:12px;font-weight:800;letter-spacing:.01em;white-space:nowrap}
      .agx-rewarded-brand a{color:#e0e7ff;text-decoration:none}
      .agx-rewarded-brand a:focus-visible,.agx-rewarded-cta:focus-visible,.agx-rewarded-close:focus-visible{outline:3px solid rgba(96,165,250,.55);outline-offset:3px}
      .agx-rewarded-actions{display:flex;align-items:center;gap:10px;flex-shrink:0}
      .agx-rewarded-timer{min-width:48px;height:36px;padding:0 12px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.14);color:#fff;font-size:13px;font-weight:950;font-variant-numeric:tabular-nums;box-shadow:inset 0 1px 0 rgba(255,255,255,.1);transition:transform .18s ease,background .18s ease}
      .agx-rewarded-close{width:44px;height:44px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.1);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:24px;line-height:1;font-weight:500;box-shadow:0 12px 30px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.14);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);cursor:pointer;transition:transform .16s ease,opacity .16s ease,background .16s ease}
      .agx-rewarded-close:disabled{opacity:.48;cursor:not-allowed}
      .agx-rewarded-close:not(:disabled):hover{transform:translateY(-1px) scale(1.03);background:rgba(255,255,255,.16)}
      .agx-rewarded-hero{display:block;width:100%;aspect-ratio:4/5;max-height:min(56dvh,520px);object-fit:cover;background:#0f172a;border-radius:26px;box-shadow:0 18px 52px rgba(0,0,0,.34);cursor:pointer}
      .agx-rewarded-body{padding:18px 4px 2px;text-align:center}
      .agx-rewarded-title{margin:0 auto 8px;max-width:100%;font-size:21px;line-height:1.18;font-weight:950;letter-spacing:-.025em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fff}
      .agx-rewarded-desc{margin:0 auto 18px;max-width:340px;color:#cbd5e1;font-size:14px;line-height:1.45;font-weight:650;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
      .agx-rewarded-cta{width:100%;min-height:50px;border:0;border-radius:18px;background:linear-gradient(135deg,#7c3aed 0%,#2563eb 48%,#06b6d4 100%);color:#fff;font-size:15px;font-weight:950;letter-spacing:-.01em;padding:14px 18px;cursor:pointer;box-shadow:0 16px 34px rgba(37,99,235,.34);transition:transform .16s ease,filter .16s ease}
      .agx-rewarded-cta:hover{transform:translateY(-1px);filter:saturate(1.08)}
      .agx-rewarded-cta:active{transform:translateY(0) scale(.99)}
      @keyframes agxRewardedFade{from{opacity:0}to{opacity:1}}
      @keyframes agxRewardedPop{from{opacity:0;transform:translate3d(0,10px,0) scale(.975)}to{opacity:1;transform:translate3d(0,0,0) scale(1)}}
      @media (prefers-color-scheme:light){.agx-rewarded-overlay{background:radial-gradient(circle at 50% 0%,rgba(59,130,246,.15),transparent 34%),rgba(248,250,252,.72)}.agx-rewarded-card{background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(248,250,252,.98));border-color:rgba(15,23,42,.08);box-shadow:0 32px 90px rgba(15,23,42,.18),0 12px 40px rgba(37,99,235,.12);color:#0f172a}.agx-rewarded-brand{color:#64748b}.agx-rewarded-brand a{color:#334155}.agx-rewarded-timer,.agx-rewarded-close{background:rgba(15,23,42,.06);border-color:rgba(15,23,42,.08);color:#0f172a;box-shadow:0 10px 24px rgba(15,23,42,.08),inset 0 1px 0 rgba(255,255,255,.7)}.agx-rewarded-title{color:#0f172a}.agx-rewarded-desc{color:#475569}.agx-rewarded-hero{background:#e2e8f0}}
      @media (orientation:landscape) and (max-height:560px){.agx-rewarded-overlay{align-items:center;padding:calc(env(safe-area-inset-top) + 10px) max(16px,env(safe-area-inset-right)) calc(env(safe-area-inset-bottom) + 10px) max(16px,env(safe-area-inset-left))}.agx-rewarded-card{width:min(640px,100%);max-height:calc(100dvh - 20px);border-radius:24px}.agx-rewarded-hero{max-height:42dvh}.agx-rewarded-body{padding-top:12px}.agx-rewarded-desc{margin-bottom:12px}}
      @media (max-width:360px){.agx-rewarded-card{border-radius:26px;padding:12px}.agx-rewarded-hero{border-radius:22px}.agx-rewarded-title{font-size:19px}.agx-rewarded-desc{font-size:13px}.agx-rewarded-close{width:42px;height:42px}}
    `;
    const panel = document.createElement("div");
    panel.className = "agx-rewarded-card";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Sponsored rewarded ad");
    const header = document.createElement("div");
    header.className = "agx-rewarded-top";
    const brandAttribution = document.createElement("div");
    brandAttribution.className = "agx-rewarded-brand";
    brandAttribution.innerHTML = `Sponsored &middot; <a href="${ADSGALAXY_BOT_URL}" target="_blank" rel="noopener noreferrer">AdsGalaxy</a>`;
    const actions = document.createElement("div");
    actions.className = "agx-rewarded-actions";
    const countdown = document.createElement("div");
    countdown.className = "agx-rewarded-timer";
    countdown.textContent = "15s";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close ad");
    close.disabled = true;
    close.className = "agx-rewarded-close";
    actions.append(countdown, close);
    header.append(brandAttribution, actions);
    panel.appendChild(header);

    if (ad.image_url) {
      const image = document.createElement("img");
      image.src = ad.image_url;
      image.alt = displayTitle;
      image.loading = "eager";
      image.decoding = "async";
      image.className = "agx-rewarded-hero";
      image.onclick = () => {
        openTrackedLanding();
      };
      panel.appendChild(image);
    }

    const body = document.createElement("div");
    body.className = "agx-rewarded-body";
    const title = document.createElement("div");
    title.textContent = displayTitle;
    title.className = "agx-rewarded-title";
    if (ad.title_color) title.style.color = ad.title_color;
    const description = document.createElement("div");
    description.textContent = displayDescription;
    description.className = "agx-rewarded-desc";
    if (ad.body_color) description.style.color = ad.body_color;
    const cta = document.createElement("button");
    cta.textContent = `${ad.cta_text || "Learn More"}  ↗`;
    cta.style.cssText = "width:100%;border:0;border-radius:9px;background:#4f46ff;color:#fff;font-size:16px;font-weight:900;padding:14px 12px;cursor:pointer;box-shadow:0 10px 22px rgba(79,70,255,.25);";
    cta.type = "button";
    cta.textContent = displayCta;
    cta.className = "agx-rewarded-cta";
    cta.onclick = () => openTrackedLanding();
    const attribution = document.createElement("a");
    attribution.href = ADSGALAXY_BOT_URL;
    attribution.target = "_blank";
    attribution.rel = "noopener noreferrer";
    attribution.innerHTML = `<span style="display:inline-flex;width:34px;height:34px;border-radius:999px;align-items:center;justify-content:center;background:rgba(79,70,255,.12);color:#6d5cff;font-size:23px;font-weight:900;">◎</span><span style="color:#747b8d;">Sponsored by</span><strong style="color:#676bff;">AdsGalaxy</strong>`;
    attribution.style.cssText = "display:flex;align-items:center;justify-content:center;gap:10px;margin:16px 0 14px;padding-top:14px;border-top:1px solid rgba(148,163,184,.12);text-decoration:none;font-size:15px;font-weight:800;";
    const countdownBox = document.createElement("div");
    countdownBox.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid rgba(148,163,184,.16);border-radius:14px;background:rgba(15,23,42,.38);padding:10px 10px 10px 16px;";
    const countdownLabel = document.createElement("div");
    countdownLabel.innerHTML = `<span style="display:inline-flex;width:24px;height:24px;border:2px solid #8791a5;border-radius:999px;align-items:center;justify-content:center;margin-right:9px;font-size:12px;color:#8791a5;">◷</span><span>Skip in <strong>15s</strong></span>`;
    countdownLabel.style.cssText = "display:flex;align-items:center;color:#9aa3b5;font-size:15px;font-weight:800;";
    const legacyCountdown = document.createElement("div");
    legacyCountdown.textContent = "15";
    legacyCountdown.style.cssText = "display:none;";
    const helper = document.createElement("div");
    helper.textContent = "";
    helper.style.cssText = "padding-top:10px;color:#747b8d;font-size:12px;font-weight:700;line-height:1.35;";
    countdownBox.append(countdownLabel, legacyCountdown);
    body.append(title, description, cta);
    panel.appendChild(body);
    overlay.appendChild(style);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const impressionTimer = window.setTimeout(() => {
      impressionSent = true;
      const event = { event_type: "impression_recorded" as const, watch_duration_seconds: 1.5 };
      lifecycle?.onImpression?.(event).catch(() => undefined);
    }, 1500);
    const countdownTimer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil(maxSeconds - elapsedSeconds()));
      countdown.textContent = `${remaining}s`;
      countdownLabel.innerHTML = `<span style="display:inline-flex;width:24px;height:24px;border:2px solid #8791a5;border-radius:999px;align-items:center;justify-content:center;margin-right:9px;font-size:12px;color:#8791a5;">◷</span><span>Skip in <strong>${remaining}s</strong></span>`;
      if (remaining <= 0) {
        close.disabled = false;
        close.setAttribute("aria-label", "Close ad and continue");
        window.clearInterval(countdownTimer);
      } else if (impressionSent && remaining % 5 === 0) {
        sendQualityEvent({ event_type: "watch_update", watch_duration_seconds: elapsedSeconds() });
      }
    }, 250);

    close.onclick = complete;
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pagehide", onPageHide);
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
    }), signal: AbortSignal.timeout(12000),
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
        if (!isRetryableSdkError(adResult.error_code) || !currentDecision.fallback_available) return adResult;
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
      } catch (error: any) {
        if (internalImpressionConfirmed) return adResult;
        return errorResult(selectedNetwork, "IMPRESSION_FAILED", error?.message || "Ad displayed but impression confirmation failed");
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
      const confirmation = await confirmImpression(input, selectedNetwork, currentDecision.request_id);
      return {
        ...adResult,
        reward_eligible: Boolean(confirmation?.reward_eligible),
        status: String(confirmation?.status || "pending_provider_confirmation"),
      };
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
    }), signal: AbortSignal.timeout(12000),
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
