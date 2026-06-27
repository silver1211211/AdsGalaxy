<?php

class AdsGalaxyClient {
    private string $apiKey;
    private string $baseUrl;

    public function __construct(string $apiKey, string $baseUrl = "https://app.adsgalaxy.online") {
        if ($apiKey === "") {
            throw new InvalidArgumentException("AdsGalaxy apiKey is required");
        }
        $this->apiKey = $apiKey;
        $this->baseUrl = rtrim($baseUrl, "/");
    }

    public function request(string $path, array $payload = []): array {
        $ch = curl_init($this->baseUrl . $path);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ["Content-Type: application/json", "x-api-key: " . $this->apiKey],
            CURLOPT_POSTFIELDS => json_encode($payload),
        ]);
        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $data = json_decode($body ?: "{}", true) ?: [];
        if ($status < 200 || $status >= 300) {
            throw new RuntimeException($data["error"] ?? "AdsGalaxy API request failed");
        }
        return $data;
    }

    public function requestRewardedAd(array $payload): array { return $this->request("/api/v1/rewarded/request", $payload); }
    public function verifyReward(array $payload): array { return $this->request("/api/v1/rewarded/verify", $payload); }
    public function postback(array $payload): array { return $this->request("/api/v1/postbacks", $payload); }
    public function loadCampaign(array $payload): array { return $this->request("/api/v1/bot/campaigns", $payload); }
    public function trackConversion(array $payload): array { return $this->request("/api/v1/bot/events", array_merge(["event_type" => "conversion"], $payload)); }
}
