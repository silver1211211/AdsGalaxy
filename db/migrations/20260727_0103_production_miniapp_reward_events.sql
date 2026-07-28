-- Reward Callback V1 Phase 1: application bindings, immutable reward events,
-- atomic claims, and lifecycle evidence history.
-- Additive only. Completion routes are connected in a later phase.

CREATE TABLE IF NOT EXISTS developer_application_miniapps (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id BIGINT UNSIGNED NOT NULL,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  environment VARCHAR(20) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_developer_application_miniapp_environment (application_id, miniapp_id, environment),
  UNIQUE KEY uniq_developer_miniapp_environment (miniapp_id, environment),
  KEY idx_developer_application_miniapps_app_status (application_id, status),
  CONSTRAINT fk_developer_application_miniapps_application
    FOREIGN KEY (application_id) REFERENCES developer_applications(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_developer_application_miniapps_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS miniapp_reward_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(64) NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  application_id BIGINT UNSIGNED NULL,
  publisher_id INT NOT NULL,
  telegram_user_id BIGINT NOT NULL,
  external_user_reference VARCHAR(160) NULL,
  provider VARCHAR(50) NOT NULL,
  provider_event_id VARCHAR(255) NULL,
  status VARCHAR(40) NOT NULL,
  verification_level VARCHAR(40) NOT NULL,
  reward_eligible TINYINT(1) NOT NULL DEFAULT 0,
  completed_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  claimed_at DATETIME NULL,
  claimed_by_key_id BIGINT UNSIGNED NULL,
  claimed_by_application_id BIGINT UNSIGNED NULL,
  reversed_at DATETIME NULL,
  reversal_reason VARCHAR(255) NULL,
  environment VARCHAR(20) NOT NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_miniapp_reward_event_id (event_id),
  UNIQUE KEY uniq_miniapp_reward_request_id (request_id),
  UNIQUE KEY uniq_miniapp_reward_provider_event (provider, provider_event_id),
  KEY idx_miniapp_reward_app_status_created (miniapp_id, status, created_at),
  KEY idx_miniapp_reward_application_status_created (application_id, status, created_at),
  KEY idx_miniapp_reward_telegram_created (telegram_user_id, created_at),
  KEY idx_miniapp_reward_status_expires (status, expires_at),
  CONSTRAINT fk_miniapp_reward_events_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_miniapp_reward_events_application
    FOREIGN KEY (application_id) REFERENCES developer_applications(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_miniapp_reward_events_claimed_key
    FOREIGN KEY (claimed_by_key_id) REFERENCES developer_api_keys(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_miniapp_reward_events_claimed_application
    FOREIGN KEY (claimed_by_application_id) REFERENCES developer_applications(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS miniapp_reward_claims (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reward_event_id BIGINT UNSIGNED NOT NULL,
  public_claim_id VARCHAR(64) NOT NULL,
  application_id BIGINT UNSIGNED NOT NULL,
  api_key_id BIGINT UNSIGNED NOT NULL,
  idempotency_key VARCHAR(160) NOT NULL,
  external_user_reference VARCHAR(160) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'claimed',
  response_payload JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_miniapp_reward_claim_event (reward_event_id),
  UNIQUE KEY uniq_miniapp_reward_claim_public_id (public_claim_id),
  UNIQUE KEY uniq_miniapp_reward_claim_idempotency (application_id, idempotency_key),
  CONSTRAINT fk_miniapp_reward_claims_event
    FOREIGN KEY (reward_event_id) REFERENCES miniapp_reward_events(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_miniapp_reward_claims_application
    FOREIGN KEY (application_id) REFERENCES developer_applications(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_miniapp_reward_claims_api_key
    FOREIGN KEY (api_key_id) REFERENCES developer_api_keys(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS miniapp_reward_event_transitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reward_event_id BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(40) NULL,
  to_status VARCHAR(40) NOT NULL,
  from_verification_level VARCHAR(40) NULL,
  to_verification_level VARCHAR(40) NOT NULL,
  reason_code VARCHAR(80) NOT NULL,
  actor_type VARCHAR(40) NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_miniapp_reward_transition_event_created (reward_event_id, created_at),
  CONSTRAINT fk_miniapp_reward_transitions_event
    FOREIGN KEY (reward_event_id) REFERENCES miniapp_reward_events(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
