-- Secure publisher-bot webhook ingestion and idempotent bot-user storage.

SET @add_bot_webhook_timestamp = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bots' AND COLUMN_NAME = 'webhook_last_update_at') = 0,
  'ALTER TABLE bots ADD COLUMN webhook_last_update_at DATETIME NULL AFTER reactivated_at',
  'SELECT 1'
);
PREPARE add_bot_webhook_timestamp FROM @add_bot_webhook_timestamp;
EXECUTE add_bot_webhook_timestamp;
DEALLOCATE PREPARE add_bot_webhook_timestamp;

SET @add_bot_user_chat_id = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bot_users' AND COLUMN_NAME = 'chat_id') = 0,
  'ALTER TABLE bot_users ADD COLUMN chat_id VARCHAR(255) NULL AFTER user_id',
  'SELECT 1'
);
PREPARE add_bot_user_chat_id FROM @add_bot_user_chat_id;
EXECUTE add_bot_user_chat_id;
DEALLOCATE PREPARE add_bot_user_chat_id;

UPDATE bot_users
SET chat_id = user_id
WHERE (chat_id IS NULL OR chat_id = '') AND user_id IS NOT NULL AND user_id <> '';

DELETE duplicate_user
FROM bot_users duplicate_user
JOIN bot_users original_user
  ON original_user.bot_id = duplicate_user.bot_id
 AND original_user.chat_id = duplicate_user.chat_id
 AND original_user.id < duplicate_user.id
WHERE duplicate_user.chat_id IS NOT NULL AND duplicate_user.chat_id <> '';

SET @add_bot_user_unique_index = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bot_users' AND INDEX_NAME = 'uniq_bot_users_bot_chat') = 0,
  'CREATE UNIQUE INDEX uniq_bot_users_bot_chat ON bot_users (bot_id, chat_id)',
  'SELECT 1'
);
PREPARE add_bot_user_unique_index FROM @add_bot_user_unique_index;
EXECUTE add_bot_user_unique_index;
DEALLOCATE PREPARE add_bot_user_unique_index;

CREATE TABLE IF NOT EXISTS bot_webhook_updates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bot_id INT NOT NULL,
  update_id BIGINT NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_bot_webhook_update (bot_id, update_id),
  KEY idx_bot_webhook_updates_received (received_at),
  CONSTRAINT fk_bot_webhook_updates_bot
    FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
