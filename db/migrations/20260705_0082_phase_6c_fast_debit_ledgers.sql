-- Phase 6C: fast advertiser debit with delayed, idempotent publisher settlement.

SET @phase6c_first_install = (
  SELECT IF(COUNT(*)=0,1,0) FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='miniapp_internal_publisher_settlements'
);

CREATE TABLE IF NOT EXISTS channel_advertiser_debits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(160) NOT NULL,
  settlement_type ENUM('click','view') NOT NULL,
  campaign_id INT NOT NULL,
  post_id INT NOT NULL,
  channel_id INT NOT NULL,
  publisher_id INT NOT NULL,
  units BIGINT UNSIGNED NOT NULL,
  unit_price DECIMAL(18,8) NOT NULL,
  advertiser_debit DECIMAL(18,8) NOT NULL,
  publisher_status ENUM('pending','settled') NOT NULL DEFAULT 'pending',
  publisher_credit DECIMAL(18,8) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  publisher_settled_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_channel_fast_debit_source (source_key),
  KEY idx_channel_fast_debit_pending (publisher_status, created_at),
  KEY idx_channel_fast_debit_campaign_date (campaign_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS miniapp_internal_publisher_settlements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  impression_id BIGINT UNSIGNED NOT NULL,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  publisher_id INT NOT NULL,
  publisher_revenue DECIMAL(18,8) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'locked',
  stats_applied TINYINT(1) NOT NULL DEFAULT 0,
  settled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_miniapp_internal_publisher_impression (impression_id),
  KEY idx_miniapp_internal_publisher_owner (publisher_id, settled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Impressions included in legacy daily settlements were already credited.
INSERT IGNORE INTO miniapp_internal_publisher_settlements
  (impression_id,miniapp_id,publisher_id,publisher_revenue,status,stats_applied,settled_at)
SELECT i.id,i.miniapp_id,m.user_id,i.publisher_revenue,'legacy_settled',1,s.locked_at
FROM miniapp_internal_ad_impressions i
JOIN miniapps m ON m.id=i.miniapp_id
JOIN miniapp_daily_stats ds ON ds.miniapp_id=i.miniapp_id
  AND ds.network_name='AdsGalaxyInternal' AND ds.date=DATE(i.created_at)
JOIN miniapp_earnings_settlements s ON s.daily_stat_id=ds.id
WHERE @phase6c_first_install=1;

-- Revenue for other pre-migration impressions is already present in daily stats,
-- but its publisher balance still needs the new scheduled settlement.
INSERT IGNORE INTO miniapp_internal_publisher_settlements
  (impression_id,miniapp_id,publisher_id,publisher_revenue,status,stats_applied,settled_at)
SELECT i.id,i.miniapp_id,m.user_id,i.publisher_revenue,'pending',1,NOW()
FROM miniapp_internal_ad_impressions i JOIN miniapps m ON m.id=i.miniapp_id
WHERE @phase6c_first_install=1;

SET @has_broadcast_publisher_settled_at = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'broadcast_deliveries' AND COLUMN_NAME = 'publisher_settled_at'
);
SET @sql = IF(@has_broadcast_publisher_settled_at = 0,
  'ALTER TABLE broadcast_deliveries ADD COLUMN publisher_settled_at DATETIME NULL AFTER publisher_reward',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Deliveries created before the column existed were credited synchronously.
SET @sql = IF(@has_broadcast_publisher_settled_at = 0,
  'UPDATE broadcast_deliveries SET publisher_settled_at=COALESCE(last_success_at,created_at) WHERE status=''sent'' AND publisher_reward>0 AND publisher_settled_at IS NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_broadcast_pending_index = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'broadcast_deliveries' AND INDEX_NAME = 'idx_broadcast_publisher_pending'
);
SET @sql = IF(@has_broadcast_pending_index = 0,
  'CREATE INDEX idx_broadcast_publisher_pending ON broadcast_deliveries (status, publisher_settled_at, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
