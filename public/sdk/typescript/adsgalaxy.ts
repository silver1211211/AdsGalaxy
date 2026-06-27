export type AdsGalaxyOptions = {
  apiKey: string;
  baseUrl?: string;
  metadata?: Record<string, unknown>;
};

export type AdsGalaxyPayload = Record<string, unknown>;

export class AdsGalaxyClient {
  private apiKey: string;
  private baseUrl: string;
  private metadata: Record<string, unknown>;

  constructor({ apiKey, baseUrl = "https://app.adsgalaxy.online", metadata = {} }: AdsGalaxyOptions) {
    if (!apiKey) throw new Error("AdsGalaxy apiKey is required");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.metadata = metadata;
  }

  async request<T = unknown>(path: string, body: AdsGalaxyPayload = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": this.apiKey },
      body: JSON.stringify({ metadata: this.metadata, ...body }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "AdsGalaxy API request failed");
    return data as T;
  }

  loadAd(payload: AdsGalaxyPayload) { return this.request("/api/v1/ads/request", payload); }
  requestAd(payload: AdsGalaxyPayload) { return this.loadAd(payload); }
  trackImpression(requestId: string, payload: AdsGalaxyPayload = {}) { return this.request("/api/v1/ads/events", { request_id: requestId, event_type: "impression", ...payload }); }
  trackClick(requestId: string, payload: AdsGalaxyPayload = {}) { return this.request("/api/v1/ads/events", { request_id: requestId, event_type: "click", ...payload }); }
  trackCompletion(requestId: string, payload: AdsGalaxyPayload = {}) { return this.request("/api/v1/ads/events", { request_id: requestId, event_type: "completion", ...payload }); }
  trackReward(requestId: string, payload: AdsGalaxyPayload = {}) { return this.request("/api/v1/ads/events", { request_id: requestId, event_type: "reward", ...payload }); }
  verifyReward(payload: AdsGalaxyPayload) { return this.request("/api/v1/rewarded/verify", payload); }
  requestRewardedAd(payload: AdsGalaxyPayload) { return this.request("/api/v1/rewarded/request", payload); }
  rewardCallback(payload: AdsGalaxyPayload) { return this.request("/api/v1/rewarded/callback", payload); }
  postback(payload: AdsGalaxyPayload) { return this.request("/api/v1/postbacks", payload); }
}
