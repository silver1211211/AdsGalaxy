-- Channel settlement split defaults. Existing operator-configured values are preserved.
INSERT INTO settings (`key`, value, description) VALUES
  ('platform_margin_percent', '40', 'Channel campaign advertiser debit retained as AdsGalaxy platform margin'),
  ('safety_reserve_percent', '10', 'Percent of the post-margin channel publisher pool retained as safety reserve')
ON DUPLICATE KEY UPDATE description = VALUES(description);

SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_settlement_ledger' AND COLUMN_NAME='platform_margin_percent')=0,
  'ALTER TABLE channel_settlement_ledger ADD COLUMN platform_margin_percent DECIMAL(7,4) NOT NULL DEFAULT 40 AFTER advertiser_debit', 'SELECT 1');
PREPARE channel_margin_stmt FROM @ddl; EXECUTE channel_margin_stmt; DEALLOCATE PREPARE channel_margin_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_settlement_ledger' AND COLUMN_NAME='publisher_pool_before_reserve')=0,
  'ALTER TABLE channel_settlement_ledger ADD COLUMN publisher_pool_before_reserve DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER platform_margin_percent', 'SELECT 1');
PREPARE channel_margin_stmt FROM @ddl; EXECUTE channel_margin_stmt; DEALLOCATE PREPARE channel_margin_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_settlement_ledger' AND COLUMN_NAME='safety_reserve_percent')=0,
  'ALTER TABLE channel_settlement_ledger ADD COLUMN safety_reserve_percent DECIMAL(7,4) NOT NULL DEFAULT 10 AFTER publisher_pool_before_reserve', 'SELECT 1');
PREPARE channel_margin_stmt FROM @ddl; EXECUTE channel_margin_stmt; DEALLOCATE PREPARE channel_margin_stmt;
