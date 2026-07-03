-- Publisher bots keep their Telegram webhook. MySQL/MariaDB-safe, idempotent schema migration.

SET @bot_columns = CONCAT(
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bots' AND COLUMN_NAME='bot_token_encrypted'), '', 'ADD COLUMN bot_token_encrypted TEXT NULL AFTER bot_token,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bots' AND COLUMN_NAME='bot_token_hash'), '', 'ADD COLUMN bot_token_hash CHAR(64) NULL AFTER bot_token_encrypted,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bots' AND COLUMN_NAME='integration_secret_encrypted'), '', 'ADD COLUMN integration_secret_encrypted TEXT NULL AFTER webhook_url,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bots' AND COLUMN_NAME='integration_secret_hash'), '', 'ADD COLUMN integration_secret_hash CHAR(64) NULL AFTER integration_secret_encrypted,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bots' AND COLUMN_NAME='integration_installed_at'), '', 'ADD COLUMN integration_installed_at DATETIME NULL AFTER integration_secret_hash,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bots' AND COLUMN_NAME='integration_last_received_at'), '', 'ADD COLUMN integration_last_received_at DATETIME NULL AFTER integration_installed_at,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bots' AND COLUMN_NAME='integration_last_user_id'), '', 'ADD COLUMN integration_last_user_id VARCHAR(255) NULL AFTER integration_last_received_at,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bots' AND COLUMN_NAME='integration_last_error_at'), '', 'ADD COLUMN integration_last_error_at DATETIME NULL AFTER integration_last_user_id,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bots' AND COLUMN_NAME='integration_last_error'), '', 'ADD COLUMN integration_last_error VARCHAR(500) NULL AFTER integration_last_error_at,')
);
SET @bot_sql = IF(@bot_columns='', 'SELECT 1', CONCAT('ALTER TABLE bots ', TRIM(TRAILING ',' FROM @bot_columns)));
PREPARE bot_stmt FROM @bot_sql; EXECUTE bot_stmt; DEALLOCATE PREPARE bot_stmt;

ALTER TABLE bots
  MODIFY COLUMN webhook_url VARCHAR(500) NULL COMMENT 'Legacy Telegram webhook URL; retained for backward compatibility and migration only';

SET @user_columns = CONCAT(
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bot_users' AND COLUMN_NAME='telegram_username'), '', 'ADD COLUMN telegram_username VARCHAR(255) NULL AFTER chat_id,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bot_users' AND COLUMN_NAME='telegram_first_name'), '', 'ADD COLUMN telegram_first_name VARCHAR(255) NULL AFTER telegram_username,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bot_users' AND COLUMN_NAME='telegram_language_code'), '', 'ADD COLUMN telegram_language_code VARCHAR(16) NULL AFTER telegram_first_name,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bot_users' AND COLUMN_NAME='registered_at'), '', 'ADD COLUMN registered_at DATETIME NULL AFTER telegram_language_code,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bot_users' AND COLUMN_NAME='first_seen_at'), '', 'ADD COLUMN first_seen_at DATETIME NULL AFTER registered_at,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bot_users' AND COLUMN_NAME='last_seen_at'), '', 'ADD COLUMN last_seen_at DATETIME NULL AFTER first_seen_at,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bot_users' AND COLUMN_NAME='duplicate_start_count'), '', 'ADD COLUMN duplicate_start_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER last_seen_at,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bot_users' AND COLUMN_NAME='integration_first_seen_at'), '', 'ADD COLUMN integration_first_seen_at DATETIME NULL AFTER duplicate_start_count,')
  ,IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bot_users' AND COLUMN_NAME='source'), '', 'ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT ''legacy'' AFTER integration_first_seen_at,')
);
SET @user_sql = IF(@user_columns='', 'SELECT 1', CONCAT('ALTER TABLE bot_users ', TRIM(TRAILING ',' FROM @user_columns)));
PREPARE user_stmt FROM @user_sql; EXECUTE user_stmt; DEALLOCATE PREPARE user_stmt;

UPDATE bot_users
SET first_seen_at = COALESCE(first_seen_at, registered_at, NOW()),
    last_seen_at = COALESCE(last_seen_at, registered_at, NOW())
WHERE first_seen_at IS NULL OR last_seen_at IS NULL;

CREATE TABLE IF NOT EXISTS bot_integration_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bot_id INT NOT NULL,
  event_type ENUM('user', 'duplicate', 'test', 'error', 'rate_limited', 'secret_regenerated') NOT NULL,
  telegram_user_id VARCHAR(255) NULL,
  username VARCHAR(255) NULL,
  message VARCHAR(500) NOT NULL,
  source_hash CHAR(64) NULL,
  request_id_hash CHAR(64) NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bot_integration_events_bot_time (bot_id, received_at),
  KEY idx_bot_integration_events_rate (bot_id, source_hash, received_at),
  UNIQUE KEY uniq_bot_integration_request (bot_id, request_id_hash),
  CONSTRAINT fk_bot_integration_events_bot FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @event_username_sql = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bot_integration_events' AND COLUMN_NAME='username'),
  'SELECT 1',
  'ALTER TABLE bot_integration_events ADD COLUMN username VARCHAR(255) NULL AFTER telegram_user_id'
);
PREPARE event_stmt FROM @event_username_sql; EXECUTE event_stmt; DEALLOCATE PREPARE event_stmt;

ALTER TABLE bot_integration_events
  MODIFY COLUMN event_type ENUM('user', 'duplicate', 'test', 'error', 'rate_limited', 'secret_regenerated') NOT NULL;

SET @event_request_sql = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bot_integration_events' AND COLUMN_NAME='request_id_hash'),
  'SELECT 1',
  'ALTER TABLE bot_integration_events ADD COLUMN request_id_hash CHAR(64) NULL AFTER source_hash, ADD UNIQUE INDEX uniq_bot_integration_request (bot_id, request_id_hash)'
);
PREPARE request_stmt FROM @event_request_sql; EXECUTE request_stmt; DEALLOCATE PREPARE request_stmt;

CREATE INDEX IF NOT EXISTS idx_bots_token_hash ON bots (bot_token_hash);
