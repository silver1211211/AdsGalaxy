-- Phase 8B support-message backfill controls and dry-run compatibility.

SET @queue_status_sql = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'support_message_queue'
      AND COLUMN_NAME = 'status'
      AND COLUMN_TYPE NOT LIKE '%dry_run%'
  ),
  'ALTER TABLE support_message_queue MODIFY status ENUM(''queued'',''sending'',''sent'',''failed'',''retry_scheduled'',''permanently_failed'',''paused'',''dry_run'') NOT NULL DEFAULT ''queued''',
  'SELECT 1'
);
PREPARE queue_status_stmt FROM @queue_status_sql;
EXECUTE queue_status_stmt;
DEALLOCATE PREPARE queue_status_stmt;

CREATE TABLE IF NOT EXISTS support_message_backfill_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_type VARCHAR(80) NOT NULL,
  status ENUM('running','paused','cancelled','completed','failed') NOT NULL DEFAULT 'running',
  total_eligible INT UNSIGNED NOT NULL DEFAULT 0,
  queued_count INT UNSIGNED NOT NULL DEFAULT 0,
  skip_permanently_failed TINYINT(1) NOT NULL DEFAULT 1,
  batch_size INT UNSIGNED NOT NULL DEFAULT 100,
  last_user_id INT UNSIGNED NOT NULL DEFAULT 0,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paused_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  completed_at DATETIME NULL,
  last_error_code VARCHAR(80) NULL,
  last_error_message VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_support_backfill_status (status, message_type, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO support_message_settings (`key`, value, description) VALUES
  ('support_messages_max_per_hour', '60', 'Maximum real support-account sends per hour.'),
  ('support_messages_max_per_day', '300', 'Maximum real support-account sends per day.')
ON DUPLICATE KEY UPDATE `key` = VALUES(`key`);
