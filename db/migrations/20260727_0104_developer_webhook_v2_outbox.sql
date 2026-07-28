-- Reward Callback V1: additive webhook v2 outbox, leases, retries, and secret rotation.
-- Existing webhook v1 rows remain valid and continue using their current columns.

ALTER TABLE developer_webhooks
  ADD COLUMN secret_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER secret,
  ADD COLUMN previous_secret VARCHAR(120) NULL AFTER secret_version,
  ADD COLUMN previous_secret_version INT UNSIGNED NULL AFTER previous_secret,
  ADD COLUMN previous_secret_expires_at DATETIME NULL AFTER previous_secret_version,
  ADD COLUMN secret_rotated_at DATETIME NULL AFTER previous_secret_expires_at;

ALTER TABLE developer_webhook_deliveries
  ADD COLUMN event_id VARCHAR(64) NULL AFTER event_type,
  ADD COLUMN webhook_version VARCHAR(20) NOT NULL DEFAULT 'v1' AFTER event_id,
  ADD COLUMN signature_version VARCHAR(20) NOT NULL DEFAULT 'v1' AFTER webhook_version,
  ADD COLUMN secret_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER signature_version,
  ADD COLUMN signing_secret VARCHAR(120) NULL AFTER secret_version,
  ADD COLUMN logical_delivery_key VARCHAR(255) NULL AFTER signing_secret,
  ADD COLUMN manual_retry_sequence INT UNSIGNED NOT NULL DEFAULT 0 AFTER logical_delivery_key,
  ADD COLUMN claimed_at DATETIME NULL AFTER next_attempt_at,
  ADD COLUMN claim_token VARCHAR(64) NULL AFTER claimed_at,
  ADD COLUMN claim_expires_at DATETIME NULL AFTER claim_token,
  ADD COLUMN last_attempt_at DATETIME NULL AFTER claim_expires_at,
  ADD COLUMN terminal_at DATETIME NULL AFTER last_attempt_at,
  ADD COLUMN manually_retried_from_id BIGINT UNSIGNED NULL AFTER terminal_at,
  ADD UNIQUE KEY uniq_developer_webhook_delivery_logical (logical_delivery_key),
  ADD KEY idx_developer_webhook_delivery_claim (status, next_attempt_at, claim_expires_at),
  ADD KEY idx_developer_webhook_delivery_event_id (event_id, event_type),
  ADD KEY idx_developer_webhook_delivery_manual_source (manually_retried_from_id),
  ADD CONSTRAINT fk_developer_webhook_delivery_manual_source
    FOREIGN KEY (manually_retried_from_id) REFERENCES developer_webhook_deliveries(id)
    ON DELETE SET NULL;

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
