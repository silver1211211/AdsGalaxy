-- Idempotent daily channel and campaign-post analytics foundation.
CREATE TABLE IF NOT EXISTS channel_post_daily_stats (
  stat_date DATE NOT NULL,
  channel_id INT NOT NULL,
  post_id INT NOT NULL,
  campaign_id INT NULL,
  total_views INT UNSIGNED NOT NULL DEFAULT 0,
  views INT UNSIGNED NOT NULL DEFAULT 0,
  total_clicks INT UNSIGNED NOT NULL DEFAULT 0,
  clicks INT UNSIGNED NOT NULL DEFAULT 0,
  view_earnings DECIMAL(18,8) NOT NULL DEFAULT 0,
  click_earnings DECIMAL(18,8) NOT NULL DEFAULT 0,
  earnings DECIMAL(18,8) NOT NULL DEFAULT 0,
  view_spend DECIMAL(18,8) NOT NULL DEFAULT 0,
  click_spend DECIMAL(18,8) NOT NULL DEFAULT 0,
  spend DECIMAL(18,8) NOT NULL DEFAULT 0,
  platform_revenue DECIMAL(18,8) NOT NULL DEFAULT 0,
  reserve_amount DECIMAL(18,8) NOT NULL DEFAULT 0,
  ctr DECIMAL(12,6) NOT NULL DEFAULT 0,
  average_cpm DECIMAL(18,8) NOT NULL DEFAULT 0,
  average_cpc DECIMAL(18,8) NOT NULL DEFAULT 0,
  effective_publisher_cpm DECIMAL(18,8) NOT NULL DEFAULT 0,
  effective_publisher_cpc DECIMAL(18,8) NOT NULL DEFAULT 0,
  active_post TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (stat_date, post_id),
  KEY idx_channel_post_daily_channel_date (channel_id, stat_date),
  KEY idx_channel_post_daily_campaign_date (campaign_id, stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS channel_daily_stats (
  stat_date DATE NOT NULL,
  channel_id INT NOT NULL,
  views INT UNSIGNED NOT NULL DEFAULT 0,
  clicks INT UNSIGNED NOT NULL DEFAULT 0,
  earnings DECIMAL(18,8) NOT NULL DEFAULT 0,
  view_earnings DECIMAL(18,8) NOT NULL DEFAULT 0,
  click_earnings DECIMAL(18,8) NOT NULL DEFAULT 0,
  view_spend DECIMAL(18,8) NOT NULL DEFAULT 0,
  click_spend DECIMAL(18,8) NOT NULL DEFAULT 0,
  spend DECIMAL(18,8) NOT NULL DEFAULT 0,
  platform_revenue DECIMAL(18,8) NOT NULL DEFAULT 0,
  reserve_amount DECIMAL(18,8) NOT NULL DEFAULT 0,
  ctr DECIMAL(12,6) NOT NULL DEFAULT 0,
  average_cpm DECIMAL(18,8) NOT NULL DEFAULT 0,
  average_cpc DECIMAL(18,8) NOT NULL DEFAULT 0,
  effective_publisher_cpm DECIMAL(18,8) NOT NULL DEFAULT 0,
  effective_publisher_cpc DECIMAL(18,8) NOT NULL DEFAULT 0,
  active_posts INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (stat_date, channel_id),
  KEY idx_channel_daily_channel_date (channel_id, stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Preserve legacy rows as undated while timestamping new settlement rows automatically.
SET @ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ad_settlements' AND COLUMN_NAME = 'created_at') = 0,
  'ALTER TABLE ad_settlements ADD COLUMN created_at DATETIME NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE channel_stats_stmt FROM @ddl; EXECUTE channel_stats_stmt; DEALLOCATE PREPARE channel_stats_stmt;
ALTER TABLE ad_settlements ALTER COLUMN created_at SET DEFAULT (CURRENT_TIMESTAMP);

SET @ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ad_settlements_views' AND COLUMN_NAME = 'created_at') = 0,
  'ALTER TABLE ad_settlements_views ADD COLUMN created_at DATETIME NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE channel_stats_stmt FROM @ddl; EXECUTE channel_stats_stmt; DEALLOCATE PREPARE channel_stats_stmt;
ALTER TABLE ad_settlements_views ALTER COLUMN created_at SET DEFAULT (CURRENT_TIMESTAMP);
