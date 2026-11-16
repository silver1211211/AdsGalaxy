-- Snapshot the authoritative Channel split at advertiser-debit time so delayed
-- publisher settlement cannot be changed by a later administrator update.
SET @has_platform_margin_snapshot = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_advertiser_debits' AND COLUMN_NAME='platform_margin_percent'
);
SET @sql = IF(@has_platform_margin_snapshot=0,
  'ALTER TABLE channel_advertiser_debits ADD COLUMN platform_margin_percent DECIMAL(11,8) NULL AFTER advertiser_debit',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_safety_reserve_snapshot = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_advertiser_debits' AND COLUMN_NAME='safety_reserve_percent'
);
SET @sql = IF(@has_safety_reserve_snapshot=0,
  'ALTER TABLE channel_advertiser_debits ADD COLUMN safety_reserve_percent DECIMAL(11,8) NULL AFTER platform_margin_percent',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_policy_version_snapshot = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_advertiser_debits' AND COLUMN_NAME='allocation_policy_version'
);
SET @sql = IF(@has_policy_version_snapshot=0,
  'ALTER TABLE channel_advertiser_debits ADD COLUMN allocation_policy_version VARCHAR(96) NULL AFTER safety_reserve_percent',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Existing rows deliberately remain NULL: their historic policy is unknown and
-- must be reconciled from ledgers/audit evidence rather than guessed.
