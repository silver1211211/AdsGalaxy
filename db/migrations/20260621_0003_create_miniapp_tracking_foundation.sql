-- Mini App tracking and reporting foundation.
-- Phase 2 only: aggregate stats storage. No balance credits or ad serving.

CREATE TABLE IF NOT EXISTS miniapp_daily_stats (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  network_name VARCHAR(50) NOT NULL,
  date DATE NOT NULL,
  impressions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  gross_revenue DECIMAL(18,8) NOT NULL DEFAULT 0,
  ads_galaxy_fee DECIMAL(18,8) NOT NULL DEFAULT 0,
  publisher_revenue DECIMAL(18,8) NOT NULL DEFAULT 0,
  gross_cpm DECIMAL(18,8) NOT NULL DEFAULT 0,
  net_cpm DECIMAL(18,8) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_miniapp_daily_stats (miniapp_id, network_name, date),
  KEY idx_miniapp_daily_stats_date (date),
  CONSTRAINT fk_miniapp_daily_stats_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS miniapp_country_stats (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  network_name VARCHAR(50) NOT NULL,
  country VARCHAR(2) NOT NULL,
  date DATE NOT NULL,
  impressions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_miniapp_country_stats (miniapp_id, network_name, country, date),
  KEY idx_miniapp_country_stats_date (date),
  CONSTRAINT fk_miniapp_country_stats_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO settings (`key`, value)
VALUES ('miniapp_ads_galaxy_fee_percent', '15');
