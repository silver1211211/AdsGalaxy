(function (global) {
  function AdsGalaxyMiniApp(options) {
    if (!options || !options.apiKey) throw new Error("AdsGalaxy apiKey is required");
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || "https://app.adsgalaxy.online").replace(/\/$/, "");
    this.defaultMetadata = options.metadata || {};
  }

  AdsGalaxyMiniApp.prototype.request = async function (path, body) {
    const response = await fetch(this.baseUrl + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify(Object.assign({ metadata: this.defaultMetadata }, body || {})),
    });
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || "AdsGalaxy SDK request failed");
    return data;
  };

  AdsGalaxyMiniApp.prototype.loadAd = function (payload) {
    return this.request("/api/v1/ads/request", payload);
  };

  AdsGalaxyMiniApp.prototype.requestAd = AdsGalaxyMiniApp.prototype.loadAd;

  AdsGalaxyMiniApp.prototype.trackImpression = function (requestId, payload) {
    return this.request("/api/v1/ads/events", Object.assign({ request_id: requestId, event_type: "impression" }, payload || {}));
  };

  AdsGalaxyMiniApp.prototype.trackClick = function (requestId, payload) {
    return this.request("/api/v1/ads/events", Object.assign({ request_id: requestId, event_type: "click" }, payload || {}));
  };

  AdsGalaxyMiniApp.prototype.trackCompletion = function (requestId, payload) {
    return this.request("/api/v1/ads/events", Object.assign({ request_id: requestId, event_type: "completion" }, payload || {}));
  };

  AdsGalaxyMiniApp.prototype.trackReward = function (requestId, payload) {
    return this.request("/api/v1/ads/events", Object.assign({ request_id: requestId, event_type: "reward" }, payload || {}));
  };

  AdsGalaxyMiniApp.prototype.requestRewardVerification = function (payload) {
    return this.request("/api/v1/rewarded/verify", payload);
  };

  global.AdsGalaxyMiniApp = AdsGalaxyMiniApp;
})(typeof window !== "undefined" ? window : globalThis);
