-- Persist publisher bot webhook URLs so activation and later reads reuse one stable URL.

SET @add_bot_webhook_url = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bots' AND COLUMN_NAME = 'webhook_url') = 0,
  'ALTER TABLE bots ADD COLUMN webhook_url VARCHAR(500) NULL AFTER bot_token',
  'SELECT 1'
);
PREPARE add_bot_webhook_url FROM @add_bot_webhook_url;
EXECUTE add_bot_webhook_url;
DEALLOCATE PREPARE add_bot_webhook_url;
