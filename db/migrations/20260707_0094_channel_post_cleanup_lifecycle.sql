-- Align channel post cleanup lifecycle states with admin pause/delete/replace flows.
-- Idempotent and data-preserving.

SET @post_status_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'campaign_posts'
    AND COLUMN_NAME = 'status'
);

SET @post_status_sql := IF(
  @post_status_exists = 0,
  'ALTER TABLE campaign_posts ADD COLUMN status VARCHAR(40) NOT NULL DEFAULT ''pending_delivery''',
  'ALTER TABLE campaign_posts MODIFY COLUMN status VARCHAR(40) NOT NULL DEFAULT ''pending_delivery'''
);
PREPARE stmt FROM @post_status_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @cleanup_attempted_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'campaign_posts'
    AND COLUMN_NAME = 'cleanup_attempted_at'
);

SET @cleanup_attempted_sql := IF(
  @cleanup_attempted_exists = 0,
  'ALTER TABLE campaign_posts ADD COLUMN cleanup_attempted_at DATETIME NULL AFTER delete_failed_at',
  'SELECT 1'
);
PREPARE stmt FROM @cleanup_attempted_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @cleanup_index_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'campaign_posts'
    AND INDEX_NAME = 'idx_campaign_posts_cleanup_state'
);

SET @cleanup_index_sql := IF(
  @cleanup_index_exists = 0,
  'CREATE INDEX idx_campaign_posts_cleanup_state ON campaign_posts(status, cleanup_attempted_at, delete_failed_at)',
  'SELECT 1'
);
PREPARE stmt FROM @cleanup_index_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
