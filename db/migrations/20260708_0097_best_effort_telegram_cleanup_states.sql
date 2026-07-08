-- Best-effort Telegram cleanup state tracking.
-- Cleanup failures are operational state, not settlement failures.

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'campaign_posts'
    AND COLUMN_NAME = 'cleanup_status'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE campaign_posts ADD COLUMN cleanup_status VARCHAR(16) NOT NULL DEFAULT ''pending'' AFTER cleanup_attempted_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'campaign_posts'
    AND COLUMN_NAME = 'cleanup_completed_at'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE campaign_posts ADD COLUMN cleanup_completed_at DATETIME NULL AFTER cleanup_status',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'campaign_posts'
    AND COLUMN_NAME = 'cleanup_error'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE campaign_posts ADD COLUMN cleanup_error TEXT NULL AFTER cleanup_completed_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'campaign_posts'
    AND COLUMN_NAME = 'cleanup_retry_count'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE campaign_posts ADD COLUMN cleanup_retry_count INT NOT NULL DEFAULT 0 AFTER cleanup_error',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE campaign_posts
SET cleanup_status = CASE
    WHEN status IN ('deleted', 'replaced', 'already_missing') OR deleted_at IS NOT NULL THEN 'success'
    WHEN status = 'cleanup_pending' THEN 'pending'
    WHEN status = 'delete_failed' THEN 'failed'
    ELSE cleanup_status
  END,
  cleanup_completed_at = CASE
    WHEN (status IN ('deleted', 'replaced', 'already_missing') OR deleted_at IS NOT NULL) AND cleanup_completed_at IS NULL
      THEN COALESCE(deleted_at, cleanup_attempted_at)
    ELSE cleanup_completed_at
  END,
  cleanup_error = CASE
    WHEN cleanup_error IS NULL AND delete_failed_reason IS NOT NULL THEN delete_failed_reason
    ELSE cleanup_error
  END;

SET @index_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'campaign_posts'
    AND INDEX_NAME = 'idx_campaign_posts_best_effort_cleanup'
);
SET @sql := IF(
  @index_exists = 0,
  'CREATE INDEX idx_campaign_posts_best_effort_cleanup ON campaign_posts(cleanup_status, cleanup_attempted_at, cleanup_retry_count)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
