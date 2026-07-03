-- Incremental, auditable channel campaign settlement accounting (MySQL 8 safe to rerun).
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='campaigns' AND COLUMN_NAME='channel_spend')=0,
  'ALTER TABLE campaigns ADD COLUMN channel_spend DECIMAL(18,8) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE channel_settlement_stmt FROM @ddl; EXECUTE channel_settlement_stmt; DEALLOCATE PREPARE channel_settlement_stmt;

SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_post_daily_stats' AND COLUMN_NAME='view_spend')=0,
  'ALTER TABLE channel_post_daily_stats ADD COLUMN view_spend DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER earnings', 'SELECT 1');
PREPARE channel_settlement_stmt FROM @ddl; EXECUTE channel_settlement_stmt; DEALLOCATE PREPARE channel_settlement_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_post_daily_stats' AND COLUMN_NAME='click_spend')=0,
  'ALTER TABLE channel_post_daily_stats ADD COLUMN click_spend DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER view_spend', 'SELECT 1');
PREPARE channel_settlement_stmt FROM @ddl; EXECUTE channel_settlement_stmt; DEALLOCATE PREPARE channel_settlement_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_post_daily_stats' AND COLUMN_NAME='spend')=0,
  'ALTER TABLE channel_post_daily_stats ADD COLUMN spend DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER click_spend', 'SELECT 1');
PREPARE channel_settlement_stmt FROM @ddl; EXECUTE channel_settlement_stmt; DEALLOCATE PREPARE channel_settlement_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_daily_stats' AND COLUMN_NAME='view_spend')=0,
  'ALTER TABLE channel_daily_stats ADD COLUMN view_spend DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER click_earnings', 'SELECT 1');
PREPARE channel_settlement_stmt FROM @ddl; EXECUTE channel_settlement_stmt; DEALLOCATE PREPARE channel_settlement_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_daily_stats' AND COLUMN_NAME='click_spend')=0,
  'ALTER TABLE channel_daily_stats ADD COLUMN click_spend DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER view_spend', 'SELECT 1');
PREPARE channel_settlement_stmt FROM @ddl; EXECUTE channel_settlement_stmt; DEALLOCATE PREPARE channel_settlement_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_daily_stats' AND COLUMN_NAME='spend')=0,
  'ALTER TABLE channel_daily_stats ADD COLUMN spend DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER click_spend', 'SELECT 1');
PREPARE channel_settlement_stmt FROM @ddl; EXECUTE channel_settlement_stmt; DEALLOCATE PREPARE channel_settlement_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='campaigns' AND COLUMN_NAME='channel_publisher_earnings')=0,
  'ALTER TABLE campaigns ADD COLUMN channel_publisher_earnings DECIMAL(18,8) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE channel_settlement_stmt FROM @ddl; EXECUTE channel_settlement_stmt; DEALLOCATE PREPARE channel_settlement_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='campaigns' AND COLUMN_NAME='channel_platform_revenue')=0,
  'ALTER TABLE campaigns ADD COLUMN channel_platform_revenue DECIMAL(18,8) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE channel_settlement_stmt FROM @ddl; EXECUTE channel_settlement_stmt; DEALLOCATE PREPARE channel_settlement_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='campaigns' AND COLUMN_NAME='channel_reserve_amount')=0,
  'ALTER TABLE campaigns ADD COLUMN channel_reserve_amount DECIMAL(18,8) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE channel_settlement_stmt FROM @ddl; EXECUTE channel_settlement_stmt; DEALLOCATE PREPARE channel_settlement_stmt;

SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='campaign_posts' AND COLUMN_NAME='spend')=0,
  'ALTER TABLE campaign_posts ADD COLUMN spend DECIMAL(18,8) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE channel_settlement_stmt FROM @ddl; EXECUTE channel_settlement_stmt; DEALLOCATE PREPARE channel_settlement_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='campaign_posts' AND COLUMN_NAME='publisher_earnings')=0,
  'ALTER TABLE campaign_posts ADD COLUMN publisher_earnings DECIMAL(18,8) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE channel_settlement_stmt FROM @ddl; EXECUTE channel_settlement_stmt; DEALLOCATE PREPARE channel_settlement_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='campaign_posts' AND COLUMN_NAME='platform_revenue')=0,
  'ALTER TABLE campaign_posts ADD COLUMN platform_revenue DECIMAL(18,8) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE channel_settlement_stmt FROM @ddl; EXECUTE channel_settlement_stmt; DEALLOCATE PREPARE channel_settlement_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='campaign_posts' AND COLUMN_NAME='reserve_amount')=0,
  'ALTER TABLE campaign_posts ADD COLUMN reserve_amount DECIMAL(18,8) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE channel_settlement_stmt FROM @ddl; EXECUTE channel_settlement_stmt; DEALLOCATE PREPARE channel_settlement_stmt;

CREATE TABLE IF NOT EXISTS channel_settlement_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  settlement_type ENUM('view','click') NOT NULL,
  campaign_id INT NOT NULL,
  post_id INT NOT NULL,
  channel_id INT NOT NULL,
  publisher_id INT NOT NULL,
  old_settled_count INT UNSIGNED NOT NULL,
  new_units INT UNSIGNED NOT NULL,
  settled_through INT UNSIGNED NOT NULL,
  advertiser_debit DECIMAL(18,8) NOT NULL,
  publisher_credit DECIMAL(18,8) NOT NULL,
  platform_revenue DECIMAL(18,8) NOT NULL,
  reserve_amount DECIMAL(18,8) NOT NULL DEFAULT 0,
  remaining_budget DECIMAL(18,8) NOT NULL,
  exhausted TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_channel_settlement_post_through (settlement_type, post_id, settled_through),
  KEY idx_channel_settlement_campaign_date (campaign_id, created_at),
  KEY idx_channel_settlement_channel_date (channel_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
