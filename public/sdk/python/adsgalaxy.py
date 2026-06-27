import requests


class AdsGalaxyClient:
    def __init__(self, api_key: str, base_url: str = "https://app.adsgalaxy.online"):
        if not api_key:
            raise ValueError("AdsGalaxy api_key is required")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    def request(self, path: str, payload: dict | None = None) -> dict:
        response = requests.post(
            f"{self.base_url}{path}",
            json=payload or {},
            headers={"Content-Type": "application/json", "x-api-key": self.api_key},
            timeout=15,
        )
        data = response.json() if response.content else {}
        if not response.ok:
            raise RuntimeError(data.get("error", "AdsGalaxy API request failed"))
        return data

    def request_rewarded_ad(self, payload: dict) -> dict:
        return self.request("/api/v1/rewarded/request", payload)

    def verify_reward(self, payload: dict) -> dict:
        return self.request("/api/v1/rewarded/verify", payload)

    def postback(self, payload: dict) -> dict:
        return self.request("/api/v1/postbacks", payload)

    def load_campaign(self, payload: dict) -> dict:
        return self.request("/api/v1/bot/campaigns", payload)

    def track_conversion(self, payload: dict) -> dict:
        return self.request("/api/v1/bot/events", {"event_type": "conversion", **payload})
