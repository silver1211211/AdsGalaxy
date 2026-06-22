-- Mini App management foundation.
-- Phase 1 only: submission, review, and ad-network placement configuration.

CREATE TABLE IF NOT EXISTS miniapps (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  miniapp_name VARCHAR(255) NOT NULL,
  miniapp_username VARCHAR(255) NOT NULL,
  bot_id VARCHAR(255) NOT NULL,
  webapp_url TEXT NOT NULL,
  miniapp_url TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_miniapps_user_deleted_created (user_id, is_deleted, created_at),
  KEY idx_miniapps_status_deleted_created (status, is_deleted, created_at),
  KEY idx_miniapps_username (miniapp_username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS miniapp_ad_networks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  network_name VARCHAR(50) NOT NULL,
  network_placement_id VARCHAR(255) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_miniapp_network (miniapp_id, network_name),
  KEY idx_miniapp_ad_networks_miniapp (miniapp_id),
  CONSTRAINT fk_miniapp_ad_networks_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
