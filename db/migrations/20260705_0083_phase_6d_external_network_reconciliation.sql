-- Phase 6D: external network revenue reconciliation.
-- Additive only. Does not alter advertiser billing, settlement formulas, payout timing, or SDK integrations.

SET @has_column = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_daily_stats'
    AND COLUMN_NAME = 'provider_reported_impressions'
);
SET @sql = IF(@has_column = 0,
  'ALTER TABLE miniapp_daily_stats ADD COLUMN provider_reported_impressions BIGINT UNSIGNED NULL AFTER impressions',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_column = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_daily_stats'
    AND COLUMN_NAME = 'provider_reported_clicks'
);
SET @sql = IF(@has_column = 0,
  'ALTER TABLE miniapp_daily_stats ADD COLUMN provider_reported_clicks BIGINT UNSIGNED NULL AFTER provider_reported_impressions',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_column = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_daily_stats'
    AND COLUMN_NAME = 'provider_reported_completed_views'
);
SET @sql = IF(@has_column = 0,
  'ALTER TABLE miniapp_daily_stats ADD COLUMN provider_reported_completed_views BIGINT UNSIGNED NULL AFTER provider_reported_clicks',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_column = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_daily_stats'
    AND COLUMN_NAME = 'provider_reported_fill_rate'
);
SET @sql = IF(@has_column = 0,
  'ALTER TABLE miniapp_daily_stats ADD COLUMN provider_reported_fill_rate DECIMAL(10,6) NULL AFTER provider_reported_completed_views',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_column = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_daily_stats'
    AND COLUMN_NAME = 'provider_reported_effective_cpm'
);
SET @sql = IF(@has_column = 0,
  'ALTER TABLE miniapp_daily_stats ADD COLUMN provider_reported_effective_cpm DECIMAL(18,8) NULL AFTER provider_reported_fill_rate',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_column = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_daily_stats'
    AND COLUMN_NAME = 'reconciliation_status'
);
SET @sql = IF(@has_column = 0,
  'ALTER TABLE miniapp_daily_stats ADD COLUMN reconciliation_status VARCHAR(30) NOT NULL DEFAULT ''estimated'' AFTER revenue_review_status',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_column = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_daily_stats'
    AND COLUMN_NAME = 'reconciliation_metadata'
);
SET @sql = IF(@has_column = 0,
  'ALTER TABLE miniapp_daily_stats ADD COLUMN reconciliation_metadata JSON NULL AFTER reconciliation_status',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_column = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_daily_stats'
    AND COLUMN_NAME = 'reconciled_at'
);
SET @sql = IF(@has_column = 0,
  'ALTER TABLE miniapp_daily_stats ADD COLUMN reconciled_at DATETIME NULL AFTER reconciliation_metadata',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_index = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_daily_stats'
    AND INDEX_NAME = 'idx_miniapp_daily_stats_reconciliation'
);
SET @sql = IF(@has_index = 0,
  'CREATE INDEX idx_miniapp_daily_stats_reconciliation ON miniapp_daily_stats (reconciliation_status, reconciled_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_index = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_daily_stats'
    AND INDEX_NAME = 'idx_miniapp_daily_stats_provider_date'
);
SET @sql = IF(@has_index = 0,
  'CREATE INDEX idx_miniapp_daily_stats_provider_date ON miniapp_daily_stats (network_name, date, reconciled_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS miniapp_external_reconciliation_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'success',
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
  records_fetched INT UNSIGNED NOT NULL DEFAULT 0,
  records_updated INT UNSIGNED NOT NULL DEFAULT 0,
  records_skipped INT UNSIGNED NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  metadata JSON NULL,
  PRIMARY KEY (id),
  KEY idx_miniapp_external_reconciliation_provider (provider, started_at),
  KEY idx_miniapp_external_reconciliation_status (status, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS miniapp_external_revenue_reconciliations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider VARCHAR(50) NOT NULL,
  provider_record_id VARCHAR(255) NOT NULL,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  daily_stat_id BIGINT UNSIGNED NOT NULL,
  network_name VARCHAR(50) NOT NULL,
  date DATE NOT NULL,
  previous_gross_revenue DECIMAL(18,8) NOT NULL DEFAULT 0,
  previous_publisher_revenue DECIMAL(18,8) NOT NULL DEFAULT 0,
  reconciled_gross_revenue DECIMAL(18,8) NOT NULL DEFAULT 0,
  reconciled_publisher_revenue DECIMAL(18,8) NOT NULL DEFAULT 0,
  gross_revenue_delta DECIMAL(18,8) NOT NULL DEFAULT 0,
  publisher_revenue_delta DECIMAL(18,8) NOT NULL DEFAULT 0,
  impressions BIGINT UNSIGNED NULL,
  clicks BIGINT UNSIGNED NULL,
  completed_views BIGINT UNSIGNED NULL,
  fill_rate DECIMAL(10,6) NULL,
  effective_cpm DECIMAL(18,8) NULL,
  settlement_status VARCHAR(30) NOT NULL DEFAULT 'unsettled',
  action VARCHAR(30) NOT NULL DEFAULT 'applied',
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_miniapp_external_provider_record (provider, provider_record_id),
  KEY idx_miniapp_external_revenue_stat (daily_stat_id, created_at),
  KEY idx_miniapp_external_revenue_provider_date (provider, date),
  CONSTRAINT fk_miniapp_external_revenue_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_miniapp_external_revenue_daily_stat
    FOREIGN KEY (daily_stat_id) REFERENCES miniapp_daily_stats(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO settings (`key`, value, description) VALUES
  ('last_external_network_revenue_sync_run', '0', 'Timestamp of last external network revenue reconciliation cron run.')
ON DUPLICATE KEY UPDATE value = value;
