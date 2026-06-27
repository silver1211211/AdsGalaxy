class AdsGalaxyNodeClient {
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

  loadCampaign(payload) { return this.request("/api/v1/bot/campaigns", payload); }
  trackClick(payload) { return this.request("/api/v1/bot/events", { event_type: "click", ...payload }); }
  trackUserInteraction(payload) { return this.request("/api/v1/bot/events", { event_type: "interaction", ...payload }); }
  trackConversion(payload) { return this.request("/api/v1/bot/events", { event_type: "conversion", ...payload }); }
  trackDelivery(payload) { return this.request("/api/v1/bot/events", { event_type: "delivery", ...payload }); }
  postChannelCampaign(payload) { return this.request("/api/v1/channel/campaigns", payload); }
  channelStatus(payload) { return this.request("/api/v1/channel/status", payload); }
  channelAnalytics(payload) { return this.request("/api/v1/channel/analytics", payload); }
  reportDelivery(payload) { return this.request("/api/v1/channel/reports", { report_type: "delivery", ...payload }); }
}

module.exports = { AdsGalaxyNodeClient };
