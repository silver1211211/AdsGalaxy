SET @bot_user_verification_column_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bot_users' AND COLUMN_NAME = 'verification_attempt_count'),
  'SELECT 1',
  'ALTER TABLE bot_users ADD COLUMN verification_attempt_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER source'
);
PREPARE bot_user_verification_column_stmt FROM @bot_user_verification_column_sql;
EXECUTE bot_user_verification_column_stmt;
DEALLOCATE PREPARE bot_user_verification_column_stmt;

SET @bot_user_verification_column_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bot_users' AND COLUMN_NAME = 'verification_last_attempt_at'),
  'SELECT 1',
  'ALTER TABLE bot_users ADD COLUMN verification_last_attempt_at DATETIME NULL AFTER verification_attempt_count'
);
PREPARE bot_user_verification_column_stmt FROM @bot_user_verification_column_sql;
EXECUTE bot_user_verification_column_stmt;
DEALLOCATE PREPARE bot_user_verification_column_stmt;

SET @bot_user_verification_column_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bot_users' AND COLUMN_NAME = 'verification_next_attempt_at'),
  'SELECT 1',
  'ALTER TABLE bot_users ADD COLUMN verification_next_attempt_at DATETIME NULL AFTER verification_last_attempt_at'
);
PREPARE bot_user_verification_column_stmt FROM @bot_user_verification_column_sql;
EXECUTE bot_user_verification_column_stmt;
DEALLOCATE PREPARE bot_user_verification_column_stmt;

SET @bot_user_verification_column_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bot_users' AND COLUMN_NAME = 'verification_last_error'),
  'SELECT 1',
  'ALTER TABLE bot_users ADD COLUMN verification_last_error VARCHAR(500) NULL AFTER verification_next_attempt_at'
);
PREPARE bot_user_verification_column_stmt FROM @bot_user_verification_column_sql;
EXECUTE bot_user_verification_column_stmt;
DEALLOCATE PREPARE bot_user_verification_column_stmt;

SET @bot_user_verification_column_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bot_users' AND COLUMN_NAME = 'verification_success_at'),
  'SELECT 1',
  'ALTER TABLE bot_users ADD COLUMN verification_success_at DATETIME NULL AFTER verification_last_error'
);
PREPARE bot_user_verification_column_stmt FROM @bot_user_verification_column_sql;
EXECUTE bot_user_verification_column_stmt;
DEALLOCATE PREPARE bot_user_verification_column_stmt;

SET @bot_user_verification_column_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bot_users' AND COLUMN_NAME = 'verification_message_id'),
  'SELECT 1',
  'ALTER TABLE bot_users ADD COLUMN verification_message_id BIGINT NULL AFTER verification_success_at'
);
PREPARE bot_user_verification_column_stmt FROM @bot_user_verification_column_sql;
EXECUTE bot_user_verification_column_stmt;
DEALLOCATE PREPARE bot_user_verification_column_stmt;

SET @bot_user_verification_column_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bot_users' AND COLUMN_NAME = 'verification_claim_token'),
  'SELECT 1',
  'ALTER TABLE bot_users ADD COLUMN verification_claim_token CHAR(36) NULL AFTER verification_message_id'
);
PREPARE bot_user_verification_column_stmt FROM @bot_user_verification_column_sql;
EXECUTE bot_user_verification_column_stmt;
DEALLOCATE PREPARE bot_user_verification_column_stmt;

SET @bot_user_verification_column_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bot_users' AND COLUMN_NAME = 'verification_claim_expires_at'),
  'SELECT 1',
  'ALTER TABLE bot_users ADD COLUMN verification_claim_expires_at DATETIME NULL AFTER verification_claim_token'
);
PREPARE bot_user_verification_column_stmt FROM @bot_user_verification_column_sql;
EXECUTE bot_user_verification_column_stmt;
DEALLOCATE PREPARE bot_user_verification_column_stmt;

SET @verification_queue_index_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bot_users' AND INDEX_NAME = 'idx_bot_users_verification_queue'),
  'SELECT 1',
  'CREATE INDEX idx_bot_users_verification_queue ON bot_users (status, is_active, verification_next_attempt_at, verification_claim_expires_at)'
);
PREPARE verification_queue_index_stmt FROM @verification_queue_index_sql;
EXECUTE verification_queue_index_stmt;
DEALLOCATE PREPARE verification_queue_index_stmt;
