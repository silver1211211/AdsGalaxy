-- Bind each publisher Mini App to the numeric Telegram bot ID used for
-- Telegram third-party Ed25519 initData validation.

SET @telegram_bot_id_sql = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='miniapps' AND COLUMN_NAME='telegram_bot_id'),
  'SELECT 1',
  'ALTER TABLE miniapps ADD COLUMN telegram_bot_id DECIMAL(20, 0) UNSIGNED NULL AFTER bot_id'
);
PREPARE telegram_bot_id_stmt FROM @telegram_bot_id_sql; EXECUTE telegram_bot_id_stmt; DEALLOCATE PREPARE telegram_bot_id_stmt;

-- Existing onboarding already constrained bot_id to digits. Backfill only
-- values that are safe numeric Telegram IDs; keep the legacy column intact.
UPDATE miniapps
SET telegram_bot_id = CAST(bot_id AS UNSIGNED)
WHERE telegram_bot_id IS NULL
  AND bot_id REGEXP '^[0-9]{1,20}$';

CREATE TABLE IF NOT EXISTS miniapp_sdk_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  telegram_user_id BIGINT UNSIGNED NOT NULL,
  first_name VARCHAR(255) NOT NULL DEFAULT '',
  last_name VARCHAR(255) NOT NULL DEFAULT '',
  username VARCHAR(255) NOT NULL DEFAULT '',
  language_code VARCHAR(32) NOT NULL DEFAULT '',
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_miniapp_sdk_user (miniapp_id, telegram_user_id),
  KEY idx_miniapp_sdk_users_last_seen (last_seen_at),
  CONSTRAINT fk_miniapp_sdk_users_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
