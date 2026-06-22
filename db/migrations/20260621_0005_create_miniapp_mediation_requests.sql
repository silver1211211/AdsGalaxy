-- Mini App mediation request log.
-- Phase 4 only: request logging and network configuration response foundation.

CREATE TABLE IF NOT EXISTS miniapp_mediation_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  telegram_user_id BIGINT NOT NULL,
  country VARCHAR(2) NULL,
  ad_format VARCHAR(50) NOT NULL DEFAULT 'rewarded',
  selected_network VARCHAR(50) NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_miniapp_mediation_request_id (request_id),
  KEY idx_miniapp_mediation_requests_miniapp_created (miniapp_id, created_at),
  KEY idx_miniapp_mediation_requests_user_created (telegram_user_id, created_at),
  CONSTRAINT fk_miniapp_mediation_requests_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
