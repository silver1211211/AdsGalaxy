-- Monetag protection state foundation.
-- Tracks ad opportunities per Mini App and network without counting impressions.

CREATE TABLE IF NOT EXISTS miniapp_network_frequency_state (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  network_name VARCHAR(50) NOT NULL,
  telegram_user_id BIGINT NULL,
  opportunity_count INT UNSIGNED NOT NULL DEFAULT 0,
  consecutive_user_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_telegram_user_id BIGINT NULL,
  next_allowed_opportunity INT UNSIGNED NOT NULL DEFAULT 15,
  locked_until DATETIME NULL,
  last_seen_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_miniapp_network_frequency_state (miniapp_id, network_name),
  KEY idx_miniapp_network_frequency_state_lock (network_name, locked_until),
  CONSTRAINT fk_miniapp_network_frequency_state_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
