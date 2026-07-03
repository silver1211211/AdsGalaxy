SET @add_channels_updated_at = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'channels'
      AND COLUMN_NAME = 'updated_at'
  ),
  'SELECT 1',
  'ALTER TABLE channels ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
);
PREPARE add_channels_updated_at_stmt FROM @add_channels_updated_at;
EXECUTE add_channels_updated_at_stmt;
DEALLOCATE PREPARE add_channels_updated_at_stmt;

SET @add_bot_users_source = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'bot_users'
      AND COLUMN_NAME = 'source'
  ),
  'SELECT 1',
  'ALTER TABLE bot_users ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT ''legacy'''
);
PREPARE add_bot_users_source_stmt FROM @add_bot_users_source;
EXECUTE add_bot_users_source_stmt;
DEALLOCATE PREPARE add_bot_users_source_stmt;

SET @backfill_bot_user_source = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'bot_users'
      AND COLUMN_NAME = 'integration_first_seen_at'
  ),
  'UPDATE bot_users SET source = ''integration'' WHERE integration_first_seen_at IS NOT NULL AND source = ''legacy''',
  'SELECT 1'
);
PREPARE backfill_bot_user_source_stmt FROM @backfill_bot_user_source;
EXECUTE backfill_bot_user_source_stmt;
DEALLOCATE PREPARE backfill_bot_user_source_stmt;
