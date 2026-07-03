-- Complete channel distribution ledger and statistics fields (MySQL 8 safe to rerun).
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_settlement_ledger' AND COLUMN_NAME='effective_publisher_cpc')=0,
  'ALTER TABLE channel_settlement_ledger ADD COLUMN effective_publisher_cpc DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER effective_publisher_cpm', 'SELECT 1');
PREPARE channel_distribution_stmt FROM @ddl; EXECUTE channel_distribution_stmt; DEALLOCATE PREPARE channel_distribution_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_settlement_ledger' AND COLUMN_NAME='publisher_distribution')=0,
  'ALTER TABLE channel_settlement_ledger ADD COLUMN publisher_distribution DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER publisher_credit', 'SELECT 1');
PREPARE channel_distribution_stmt FROM @ddl; EXECUTE channel_distribution_stmt; DEALLOCATE PREPARE channel_distribution_stmt;

SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_post_daily_stats' AND COLUMN_NAME='platform_revenue')=0,
  'ALTER TABLE channel_post_daily_stats ADD COLUMN platform_revenue DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER spend', 'SELECT 1');
PREPARE channel_distribution_stmt FROM @ddl; EXECUTE channel_distribution_stmt; DEALLOCATE PREPARE channel_distribution_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_post_daily_stats' AND COLUMN_NAME='reserve_amount')=0,
  'ALTER TABLE channel_post_daily_stats ADD COLUMN reserve_amount DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER platform_revenue', 'SELECT 1');
PREPARE channel_distribution_stmt FROM @ddl; EXECUTE channel_distribution_stmt; DEALLOCATE PREPARE channel_distribution_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_post_daily_stats' AND COLUMN_NAME='effective_publisher_cpm')=0,
  'ALTER TABLE channel_post_daily_stats ADD COLUMN effective_publisher_cpm DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER average_cpc', 'SELECT 1');
PREPARE channel_distribution_stmt FROM @ddl; EXECUTE channel_distribution_stmt; DEALLOCATE PREPARE channel_distribution_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_post_daily_stats' AND COLUMN_NAME='effective_publisher_cpc')=0,
  'ALTER TABLE channel_post_daily_stats ADD COLUMN effective_publisher_cpc DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER effective_publisher_cpm', 'SELECT 1');
PREPARE channel_distribution_stmt FROM @ddl; EXECUTE channel_distribution_stmt; DEALLOCATE PREPARE channel_distribution_stmt;

SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_daily_stats' AND COLUMN_NAME='platform_revenue')=0,
  'ALTER TABLE channel_daily_stats ADD COLUMN platform_revenue DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER spend', 'SELECT 1');
PREPARE channel_distribution_stmt FROM @ddl; EXECUTE channel_distribution_stmt; DEALLOCATE PREPARE channel_distribution_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_daily_stats' AND COLUMN_NAME='reserve_amount')=0,
  'ALTER TABLE channel_daily_stats ADD COLUMN reserve_amount DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER platform_revenue', 'SELECT 1');
PREPARE channel_distribution_stmt FROM @ddl; EXECUTE channel_distribution_stmt; DEALLOCATE PREPARE channel_distribution_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_daily_stats' AND COLUMN_NAME='effective_publisher_cpm')=0,
  'ALTER TABLE channel_daily_stats ADD COLUMN effective_publisher_cpm DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER average_cpc', 'SELECT 1');
PREPARE channel_distribution_stmt FROM @ddl; EXECUTE channel_distribution_stmt; DEALLOCATE PREPARE channel_distribution_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_daily_stats' AND COLUMN_NAME='effective_publisher_cpc')=0,
  'ALTER TABLE channel_daily_stats ADD COLUMN effective_publisher_cpc DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER effective_publisher_cpm', 'SELECT 1');
PREPARE channel_distribution_stmt FROM @ddl; EXECUTE channel_distribution_stmt; DEALLOCATE PREPARE channel_distribution_stmt;
