-- Stable four-batch Telegram channel view fetching and operational diagnostics.
-- INFORMATION_SCHEMA guards keep this compatible with MySQL 8 and safe to rerun.
SET @ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaign_posts' AND COLUMN_NAME = 'views') = 0,
  'ALTER TABLE campaign_posts ADD COLUMN views INT UNSIGNED NOT NULL DEFAULT 0 AFTER message_id',
  'SELECT 1'
);
PREPARE view_fetch_stmt FROM @ddl; EXECUTE view_fetch_stmt; DEALLOCATE PREPARE view_fetch_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaign_posts' AND COLUMN_NAME = 'last_views_update') = 0,
  'ALTER TABLE campaign_posts ADD COLUMN last_views_update DATETIME NULL AFTER views',
  'SELECT 1'
);
PREPARE view_fetch_stmt FROM @ddl; EXECUTE view_fetch_stmt; DEALLOCATE PREPARE view_fetch_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaign_posts' AND COLUMN_NAME = 'view_fetch_status') = 0,
  'ALTER TABLE campaign_posts ADD COLUMN view_fetch_status VARCHAR(32) NULL AFTER last_views_update',
  'SELECT 1'
);
PREPARE view_fetch_stmt FROM @ddl; EXECUTE view_fetch_stmt; DEALLOCATE PREPARE view_fetch_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaign_posts' AND COLUMN_NAME = 'view_fetch_error') = 0,
  'ALTER TABLE campaign_posts ADD COLUMN view_fetch_error VARCHAR(500) NULL AFTER view_fetch_status',
  'SELECT 1'
);
PREPARE view_fetch_stmt FROM @ddl; EXECUTE view_fetch_stmt; DEALLOCATE PREPARE view_fetch_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaign_posts' AND COLUMN_NAME = 'view_fetch_source') = 0,
  'ALTER TABLE campaign_posts ADD COLUMN view_fetch_source VARCHAR(32) NULL AFTER view_fetch_error',
  'SELECT 1'
);
PREPARE view_fetch_stmt FROM @ddl; EXECUTE view_fetch_stmt; DEALLOCATE PREPARE view_fetch_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaign_posts' AND INDEX_NAME = 'idx_campaign_posts_view_batch') = 0,
  'CREATE INDEX idx_campaign_posts_view_batch ON campaign_posts (status, delivery_failed_at, last_views_update, id)',
  'SELECT 1'
);
PREPARE view_fetch_stmt FROM @ddl; EXECUTE view_fetch_stmt; DEALLOCATE PREPARE view_fetch_stmt;

CREATE TABLE IF NOT EXISTS channel_view_fetch_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_slot TINYINT UNSIGNED NOT NULL,
  posts_checked INT UNSIGNED NOT NULL DEFAULT 0,
  views_updated INT UNSIGNED NOT NULL DEFAULT 0,
  public_views_updated INT UNSIGNED NOT NULL DEFAULT 0,
  private_views_updated INT UNSIGNED NOT NULL DEFAULT 0,
  failed_posts INT UNSIGNED NOT NULL DEFAULT 0,
  telegram_errors INT UNSIGNED NOT NULL DEFAULT 0,
  mtproto_errors INT UNSIGNED NOT NULL DEFAULT 0,
  total_eligible_posts INT UNSIGNED NOT NULL DEFAULT 0,
  skipped_posts INT UNSIGNED NOT NULL DEFAULT 0,
  error_summary JSON NULL,
  started_at DATETIME NOT NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_channel_view_fetch_runs_created (created_at),
  KEY idx_channel_view_fetch_runs_slot (batch_slot, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'channel_view_fetch_runs' AND COLUMN_NAME = 'total_eligible_posts') = 0,
  'ALTER TABLE channel_view_fetch_runs ADD COLUMN total_eligible_posts INT UNSIGNED NOT NULL DEFAULT 0 AFTER mtproto_errors',
  'SELECT 1'
);
PREPARE view_fetch_stmt FROM @ddl; EXECUTE view_fetch_stmt; DEALLOCATE PREPARE view_fetch_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'channel_view_fetch_runs' AND COLUMN_NAME = 'skipped_posts') = 0,
  'ALTER TABLE channel_view_fetch_runs ADD COLUMN skipped_posts INT UNSIGNED NOT NULL DEFAULT 0 AFTER total_eligible_posts',
  'SELECT 1'
);
PREPARE view_fetch_stmt FROM @ddl; EXECUTE view_fetch_stmt; DEALLOCATE PREPARE view_fetch_stmt;
