-- Direct Mini App reward callbacks. Additive only; no financial tables are changed.
-- Partial-run recovery: inspect INFORMATION_SCHEMA.COLUMNS/STATISTICS/TABLE_CONSTRAINTS,
-- rerun this guarded migration, verify SHOW CREATE TABLE for both affected tables,
-- and confirm the pre/post developer_webhook_deliveries row count is unchanged.
CREATE TABLE IF NOT EXISTS miniapp_reward_callbacks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  callback_url VARCHAR(2048) NOT NULL,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  signing_secret VARCHAR(120) NOT NULL,
  secret_version INT UNSIGNED NOT NULL DEFAULT 1,
  previous_signing_secret VARCHAR(120) NULL,
  previous_secret_version INT UNSIGNED NULL,
  previous_secret_expires_at DATETIME NULL,
  rotated_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_miniapp_reward_callback_miniapp (miniapp_id),
  KEY idx_miniapp_reward_callback_status (status),
  CONSTRAINT fk_miniapp_reward_callback_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE developer_webhook_deliveries
  ADD COLUMN IF NOT EXISTS miniapp_reward_callback_id BIGINT UNSIGNED NULL AFTER webhook_id,
  ADD COLUMN IF NOT EXISTS miniapp_id BIGINT UNSIGNED NULL AFTER application_id;

ALTER TABLE developer_webhook_deliveries
  ADD INDEX IF NOT EXISTS idx_direct_miniapp_reward_delivery
    (miniapp_reward_callback_id, status, created_at);

SET @add_direct_callback_fk = IF(
  EXISTS(
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'developer_webhook_deliveries'
      AND CONSTRAINT_NAME = 'fk_direct_reward_delivery_callback'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhook_deliveries ADD CONSTRAINT fk_direct_reward_delivery_callback FOREIGN KEY (miniapp_reward_callback_id) REFERENCES miniapp_reward_callbacks(id) ON DELETE SET NULL'
);
PREPARE add_direct_callback_fk_stmt FROM @add_direct_callback_fk;
EXECUTE add_direct_callback_fk_stmt;
DEALLOCATE PREPARE add_direct_callback_fk_stmt;

SET @add_direct_miniapp_fk = IF(
  EXISTS(
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'developer_webhook_deliveries'
      AND CONSTRAINT_NAME = 'fk_direct_reward_delivery_miniapp'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhook_deliveries ADD CONSTRAINT fk_direct_reward_delivery_miniapp FOREIGN KEY (miniapp_id) REFERENCES miniapps(id) ON DELETE SET NULL'
);
PREPARE add_direct_miniapp_fk_stmt FROM @add_direct_miniapp_fk;
EXECUTE add_direct_miniapp_fk_stmt;
DEALLOCATE PREPARE add_direct_miniapp_fk_stmt;
