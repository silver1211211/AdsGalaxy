export class AdsGalaxyClient {
  constructor({ apiKey, baseUrl = "https://app.adsgalaxy.online", metadata = {} }) {
    if (!apiKey) throw new Error("AdsGalaxy apiKey is required");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.metadata = metadata;
  }

  async request(path, body = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": this.apiKey },
      body: JSON.stringify({ metadata: this.metadata, ...body }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "AdsGalaxy API request failed");
    return data;
  }

  loadAd(payload) { return this.request("/api/v1/ads/request", payload); }
  requestAd(payload) { return this.loadAd(payload); }
  trackImpression(requestId, payload = {}) { return this.request("/api/v1/ads/events", { request_id: requestId, event_type: "impression", ...payload }); }
  trackClick(requestId, payload = {}) { return this.request("/api/v1/ads/events", { request_id: requestId, event_type: "click", ...payload }); }
  trackCompletion(requestId, payload = {}) { return this.request("/api/v1/ads/events", { request_id: requestId, event_type: "completion", ...payload }); }
  trackReward(requestId, payload = {}) { return this.request("/api/v1/ads/events", { request_id: requestId, event_type: "reward", ...payload }); }
  verifyReward(payload) { return this.request("/api/v1/rewarded/verify", payload); }
  requestRewardedAd(payload) { return this.request("/api/v1/rewarded/request", payload); }
  rewardCallback(payload) { return this.request("/api/v1/rewarded/callback", payload); }
  postback(payload) { return this.request("/api/v1/postbacks", payload); }
}
