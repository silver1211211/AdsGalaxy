-- Adds one-time channel welcome-post tracking so the system welcome post is
-- sent exactly once per channel (on first approval) and failures can be
-- retried without duplicating a successful send.

SET @has_welcome_post_sent_at := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'channels'
    AND COLUMN_NAME = 'welcome_post_sent_at'
);

SET @add_welcome_post_sent_at := IF(
  @has_welcome_post_sent_at = 0,
  'ALTER TABLE channels ADD COLUMN welcome_post_sent_at DATETIME NULL',
  'SELECT 1'
);

PREPARE add_welcome_post_sent_at FROM @add_welcome_post_sent_at;
EXECUTE add_welcome_post_sent_at;
DEALLOCATE PREPARE add_welcome_post_sent_at;

SET @has_welcome_post_status := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'channels'
    AND COLUMN_NAME = 'welcome_post_status'
);

SET @add_welcome_post_status := IF(
  @has_welcome_post_status = 0,
  'ALTER TABLE channels ADD COLUMN welcome_post_status VARCHAR(20) NULL',
  'SELECT 1'
);

PREPARE add_welcome_post_status FROM @add_welcome_post_status;
EXECUTE add_welcome_post_status;
DEALLOCATE PREPARE add_welcome_post_status;

SET @has_welcome_post_failure_reason := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'channels'
    AND COLUMN_NAME = 'welcome_post_failure_reason'
);

SET @add_welcome_post_failure_reason := IF(
  @has_welcome_post_failure_reason = 0,
  'ALTER TABLE channels ADD COLUMN welcome_post_failure_reason VARCHAR(255) NULL',
  'SELECT 1'
);

PREPARE add_welcome_post_failure_reason FROM @add_welcome_post_failure_reason;
EXECUTE add_welcome_post_failure_reason;
DEALLOCATE PREPARE add_welcome_post_failure_reason;

SET @has_welcome_post_attempted_at := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'channels'
    AND COLUMN_NAME = 'welcome_post_attempted_at'
);

SET @add_welcome_post_attempted_at := IF(
  @has_welcome_post_attempted_at = 0,
  'ALTER TABLE channels ADD COLUMN welcome_post_attempted_at DATETIME NULL',
  'SELECT 1'
);

PREPARE add_welcome_post_attempted_at FROM @add_welcome_post_attempted_at;
EXECUTE add_welcome_post_attempted_at;
DEALLOCATE PREPARE add_welcome_post_attempted_at;

SET @has_welcome_post_message_id := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'channels'
    AND COLUMN_NAME = 'welcome_post_message_id'
);

SET @add_welcome_post_message_id := IF(
  @has_welcome_post_message_id = 0,
  'ALTER TABLE channels ADD COLUMN welcome_post_message_id BIGINT NULL',
  'SELECT 1'
);

PREPARE add_welcome_post_message_id FROM @add_welcome_post_message_id;
EXECUTE add_welcome_post_message_id;
DEALLOCATE PREPARE add_welcome_post_message_id;

-- Append-only delivery audit trail for every publisher/withdrawal Telegram
-- notification attempt. Duplicate-send prevention itself is enforced at the
-- call site (conditional UPDATE ... WHERE status <> target, gated on
-- affectedRows) so this table does not need a uniqueness constraint — it
-- exists purely so success/failure of each attempt can be inspected later.
CREATE TABLE IF NOT EXISTS notification_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type VARCHAR(30) NOT NULL,
  entity_id BIGINT NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  telegram_id VARCHAR(64) NULL,
  status VARCHAR(10) NOT NULL,
  failure_reason VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notification_log_entity (entity_type, entity_id, event_type),
  KEY idx_notification_log_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
