-- Phase 9: mediation engine request decisions, fallback attempts, and per-Mini-App network health.

ALTER TABLE miniapp_ad_networks
  ADD COLUMN priority_order INT NOT NULL DEFAULT 0 AFTER enabled;

UPDATE miniapp_ad_networks
SET priority_order = CASE network_name
  WHEN 'AdsGram' THEN 1
  WHEN 'Monetag' THEN 2
  WHEN 'AdExium' THEN 3
  WHEN 'RichAds' THEN 4
  ELSE 99
END
WHERE priority_order = 0;

ALTER TABLE miniapp_mediation_requests
  ADD COLUMN parent_request_id VARCHAR(64) NULL AFTER request_id,
  ADD COLUMN root_request_id VARCHAR(64) NULL AFTER parent_request_id,
  ADD COLUMN candidate_networks JSON NULL AFTER root_request_id,
  ADD COLUMN attempted_networks JSON NULL AFTER candidate_networks,
  ADD COLUMN skipped_networks JSON NULL AFTER attempted_networks,
  ADD COLUMN fallback_attempts JSON NULL AFTER skipped_networks,
  ADD COLUMN decision_reason VARCHAR(255) NULL AFTER fallback_attempts,
  ADD COLUMN final_result VARCHAR(50) NULL AFTER decision_reason,
  ADD KEY idx_miniapp_mediation_requests_root (root_request_id),
  ADD KEY idx_miniapp_mediation_requests_final (miniapp_id, final_result, created_at);

UPDATE miniapp_mediation_requests
SET root_request_id = request_id
WHERE root_request_id IS NULL;

CREATE TABLE IF NOT EXISTS miniapp_network_failures (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  network_name VARCHAR(50) NOT NULL,
  request_id VARCHAR(64) NULL,
  error_code VARCHAR(50) NOT NULL,
  error_message VARCHAR(255) NULL,
  ad_format VARCHAR(50) NOT NULL DEFAULT 'rewarded',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_miniapp_network_failures_recent (miniapp_id, network_name, created_at),
  KEY idx_miniapp_network_failures_request (request_id),
  CONSTRAINT fk_miniapp_network_failures_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS miniapp_network_health (
  miniapp_id BIGINT UNSIGNED NOT NULL,
  network_name VARCHAR(50) NOT NULL,
  recent_failures INT UNSIGNED NOT NULL DEFAULT 0,
  last_failure_at DATETIME NULL,
  temporarily_disabled_until DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (miniapp_id, network_name),
  KEY idx_miniapp_network_health_disabled (network_name, temporarily_disabled_until),
  CONSTRAINT fk_miniapp_network_health_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
