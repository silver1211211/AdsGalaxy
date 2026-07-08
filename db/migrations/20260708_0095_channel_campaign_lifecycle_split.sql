-- Separate channel campaign pause/finalize/delete cleanup lifecycle markers.
-- Idempotent and backward-compatible: existing status values are preserved.

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'campaigns'
    AND COLUMN_NAME = 'channel_settlement_finalized_at'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE campaigns ADD COLUMN channel_settlement_finalized_at DATETIME NULL AFTER completed_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'campaigns'
    AND COLUMN_NAME = 'telegram_cleanup_status'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE campaigns ADD COLUMN telegram_cleanup_status VARCHAR(32) NULL AFTER channel_settlement_finalized_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'campaigns'
    AND COLUMN_NAME = 'telegram_cleanup_attempted_at'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE campaigns ADD COLUMN telegram_cleanup_attempted_at DATETIME NULL AFTER telegram_cleanup_status',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'campaigns'
    AND COLUMN_NAME = 'archived_at'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE campaigns ADD COLUMN archived_at DATETIME NULL AFTER telegram_cleanup_attempted_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'campaigns'
    AND INDEX_NAME = 'idx_campaigns_cleanup_status'
);
SET @sql := IF(
  @index_exists = 0,
  'CREATE INDEX idx_campaigns_cleanup_status ON campaigns(telegram_cleanup_status, telegram_cleanup_attempted_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
