-- Publisher Quality Index snapshots and settlement audit fields.
CREATE TABLE IF NOT EXISTS channel_publisher_quality_snapshots (
  stat_date DATE NOT NULL,
  channel_id INT NOT NULL,
  trust_score DECIMAL(8,4) NOT NULL,
  ctr_score DECIMAL(8,4) NOT NULL,
  view_authenticity_score DECIMAL(8,4) NOT NULL,
  historical_consistency_score DECIMAL(8,4) NOT NULL,
  audience_retention_score DECIMAL(8,4) NOT NULL,
  quality_score DECIMAL(8,4) NOT NULL,
  quality_weight DECIMAL(10,8) NOT NULL,
  sample_views BIGINT UNSIGNED NOT NULL DEFAULT 0,
  sample_clicks BIGINT UNSIGNED NOT NULL DEFAULT 0,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (stat_date, channel_id),
  KEY idx_channel_pqi_channel_date (channel_id, stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channels' AND COLUMN_NAME='publisher_quality_index')=0,
  'ALTER TABLE channels ADD COLUMN publisher_quality_index DECIMAL(8,4) NOT NULL DEFAULT 60', 'SELECT 1');
PREPARE channel_pqi_stmt FROM @ddl; EXECUTE channel_pqi_stmt; DEALLOCATE PREPARE channel_pqi_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channels' AND COLUMN_NAME='publisher_quality_weight')=0,
  'ALTER TABLE channels ADD COLUMN publisher_quality_weight DECIMAL(10,8) NOT NULL DEFAULT 0.6', 'SELECT 1');
PREPARE channel_pqi_stmt FROM @ddl; EXECUTE channel_pqi_stmt; DEALLOCATE PREPARE channel_pqi_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channels' AND COLUMN_NAME='publisher_quality_updated_at')=0,
  'ALTER TABLE channels ADD COLUMN publisher_quality_updated_at DATETIME NULL', 'SELECT 1');
PREPARE channel_pqi_stmt FROM @ddl; EXECUTE channel_pqi_stmt; DEALLOCATE PREPARE channel_pqi_stmt;

SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_settlement_ledger' AND COLUMN_NAME='publisher_quality_score')=0,
  'ALTER TABLE channel_settlement_ledger ADD COLUMN publisher_quality_score DECIMAL(8,4) NOT NULL DEFAULT 60 AFTER safety_reserve_percent', 'SELECT 1');
PREPARE channel_pqi_stmt FROM @ddl; EXECUTE channel_pqi_stmt; DEALLOCATE PREPARE channel_pqi_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_settlement_ledger' AND COLUMN_NAME='publisher_distribution_pool')=0,
  'ALTER TABLE channel_settlement_ledger ADD COLUMN publisher_distribution_pool DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER safety_reserve_percent', 'SELECT 1');
PREPARE channel_pqi_stmt FROM @ddl; EXECUTE channel_pqi_stmt; DEALLOCATE PREPARE channel_pqi_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_settlement_ledger' AND COLUMN_NAME='publisher_quality_weight')=0,
  'ALTER TABLE channel_settlement_ledger ADD COLUMN publisher_quality_weight DECIMAL(10,8) NOT NULL DEFAULT 0.6 AFTER publisher_quality_score', 'SELECT 1');
PREPARE channel_pqi_stmt FROM @ddl; EXECUTE channel_pqi_stmt; DEALLOCATE PREPARE channel_pqi_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_settlement_ledger' AND COLUMN_NAME='quality_holdback')=0,
  'ALTER TABLE channel_settlement_ledger ADD COLUMN quality_holdback DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER publisher_quality_weight', 'SELECT 1');
PREPARE channel_pqi_stmt FROM @ddl; EXECUTE channel_pqi_stmt; DEALLOCATE PREPARE channel_pqi_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_settlement_ledger' AND COLUMN_NAME='effective_publisher_cpm')=0,
  'ALTER TABLE channel_settlement_ledger ADD COLUMN effective_publisher_cpm DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER publisher_credit', 'SELECT 1');
PREPARE channel_pqi_stmt FROM @ddl; EXECUTE channel_pqi_stmt; DEALLOCATE PREPARE channel_pqi_stmt;
