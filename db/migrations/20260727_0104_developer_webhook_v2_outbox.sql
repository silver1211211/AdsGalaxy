-- Reward Callback V1: additive webhook v2 outbox, leases, retries, and secret rotation.
-- Existing webhook v1 rows remain valid and continue using their current columns.
-- Every ALTER is independently guarded so interrupted or repeated runs safely complete.

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhooks'
      AND COLUMN_NAME = 'secret_version'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhooks ADD COLUMN secret_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER secret'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhooks'
      AND COLUMN_NAME = 'previous_secret'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhooks ADD COLUMN previous_secret VARCHAR(120) NULL AFTER secret_version'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhooks'
      AND COLUMN_NAME = 'previous_secret_version'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhooks ADD COLUMN previous_secret_version INT UNSIGNED NULL AFTER previous_secret'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhooks'
      AND COLUMN_NAME = 'previous_secret_expires_at'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhooks ADD COLUMN previous_secret_expires_at DATETIME NULL AFTER previous_secret_version'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhooks'
      AND COLUMN_NAME = 'secret_rotated_at'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhooks ADD COLUMN secret_rotated_at DATETIME NULL AFTER previous_secret_expires_at'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhook_deliveries'
      AND COLUMN_NAME = 'event_id'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhook_deliveries ADD COLUMN event_id VARCHAR(64) NULL AFTER event_type'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhook_deliveries'
      AND COLUMN_NAME = 'webhook_version'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhook_deliveries ADD COLUMN webhook_version VARCHAR(20) NOT NULL DEFAULT ''v1'' AFTER event_id'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhook_deliveries'
      AND COLUMN_NAME = 'signature_version'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhook_deliveries ADD COLUMN signature_version VARCHAR(20) NOT NULL DEFAULT ''v1'' AFTER webhook_version'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhook_deliveries'
      AND COLUMN_NAME = 'secret_version'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhook_deliveries ADD COLUMN secret_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER signature_version'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhook_deliveries'
      AND COLUMN_NAME = 'signing_secret'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhook_deliveries ADD COLUMN signing_secret VARCHAR(120) NULL AFTER secret_version'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhook_deliveries'
      AND COLUMN_NAME = 'logical_delivery_key'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhook_deliveries ADD COLUMN logical_delivery_key VARCHAR(255) NULL AFTER signing_secret'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhook_deliveries'
      AND COLUMN_NAME = 'manual_retry_sequence'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhook_deliveries ADD COLUMN manual_retry_sequence INT UNSIGNED NOT NULL DEFAULT 0 AFTER logical_delivery_key'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhook_deliveries'
      AND COLUMN_NAME = 'claimed_at'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhook_deliveries ADD COLUMN claimed_at DATETIME NULL AFTER next_attempt_at'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhook_deliveries'
      AND COLUMN_NAME = 'claim_token'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhook_deliveries ADD COLUMN claim_token VARCHAR(64) NULL AFTER claimed_at'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhook_deliveries'
      AND COLUMN_NAME = 'claim_expires_at'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhook_deliveries ADD COLUMN claim_expires_at DATETIME NULL AFTER claim_token'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhook_deliveries'
      AND COLUMN_NAME = 'last_attempt_at'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhook_deliveries ADD COLUMN last_attempt_at DATETIME NULL AFTER claim_expires_at'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhook_deliveries'
      AND COLUMN_NAME = 'terminal_at'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhook_deliveries ADD COLUMN terminal_at DATETIME NULL AFTER last_attempt_at'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhook_deliveries'
      AND COLUMN_NAME = 'manually_retried_from_id'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhook_deliveries ADD COLUMN manually_retried_from_id BIGINT UNSIGNED NULL AFTER terminal_at'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhook_deliveries'
      AND INDEX_NAME = 'uniq_developer_webhook_delivery_logical'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhook_deliveries ADD UNIQUE KEY uniq_developer_webhook_delivery_logical (logical_delivery_key)'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhook_deliveries'
      AND INDEX_NAME = 'idx_developer_webhook_delivery_claim'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhook_deliveries ADD KEY idx_developer_webhook_delivery_claim (status, next_attempt_at, claim_expires_at)'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhook_deliveries'
      AND INDEX_NAME = 'idx_developer_webhook_delivery_event_id'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhook_deliveries ADD KEY idx_developer_webhook_delivery_event_id (event_id, event_type)'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'developer_webhook_deliveries'
      AND INDEX_NAME = 'idx_developer_webhook_delivery_manual_source'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhook_deliveries ADD KEY idx_developer_webhook_delivery_manual_source (manually_retried_from_id)'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'developer_webhook_deliveries'
      AND CONSTRAINT_NAME = 'fk_developer_webhook_delivery_manual_source'
  ),
  'SELECT 1',
  'ALTER TABLE developer_webhook_deliveries ADD CONSTRAINT fk_developer_webhook_delivery_manual_source FOREIGN KEY (manually_retried_from_id) REFERENCES developer_webhook_deliveries(id) ON DELETE SET NULL'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

CREATE TABLE IF NOT EXISTS developer_webhook_action_audits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  application_id BIGINT UNSIGNED NOT NULL,
  webhook_id BIGINT UNSIGNED NULL,
  delivery_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_developer_webhook_action_user_created (user_id, created_at),
  KEY idx_developer_webhook_action_app_created (application_id, created_at),
  CONSTRAINT fk_developer_webhook_action_application
    FOREIGN KEY (application_id) REFERENCES developer_applications(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_developer_webhook_action_webhook
    FOREIGN KEY (webhook_id) REFERENCES developer_webhooks(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_developer_webhook_action_delivery
    FOREIGN KEY (delivery_id) REFERENCES developer_webhook_deliveries(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS developer_reward_action_audits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  application_id BIGINT UNSIGNED NOT NULL,
  miniapp_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_developer_reward_action_user_created (user_id, created_at),
  KEY idx_developer_reward_action_app_created (application_id, created_at),
  CONSTRAINT fk_developer_reward_action_application
    FOREIGN KEY (application_id) REFERENCES developer_applications(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_developer_reward_action_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
