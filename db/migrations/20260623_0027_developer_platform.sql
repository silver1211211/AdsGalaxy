-- Phase 13: public SDK, developer platform, API keys, webhooks, sandbox, and usage analytics.
-- Additive only. Does not modify CPM, payout, fraud, referral sprint, marketplace, or revenue protection.

CREATE TABLE IF NOT EXISTS developer_platform_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(120) NOT NULL,
  value VARCHAR(255) NOT NULL,
  description VARCHAR(255) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_developer_platform_setting (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS developer_applications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  name VARCHAR(160) NOT NULL,
  platform VARCHAR(40) NOT NULL DEFAULT 'telegram_mini_app',
  mode VARCHAR(20) NOT NULL DEFAULT 'sandbox',
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  permissions JSON NULL,
  allowed_ips TEXT NULL,
  allowed_origins TEXT NULL,
  webhook_url VARCHAR(500) NULL,
  webhook_secret VARCHAR(120) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  suspended_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_developer_apps_user (user_id, status, created_at),
  KEY idx_developer_apps_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS developer_api_keys (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id BIGINT UNSIGNED NOT NULL,
  user_id INT NOT NULL,
  key_type VARCHAR(20) NOT NULL,
  key_prefix VARCHAR(32) NOT NULL,
  key_hash CHAR(64) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  permissions JSON NULL,
  allowed_ips TEXT NULL,
  allowed_origins TEXT NULL,
  last_used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disabled_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_developer_api_key_hash (key_hash),
  KEY idx_developer_api_key_prefix (key_prefix, status),
  KEY idx_developer_api_key_app (application_id, key_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS developer_api_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id BIGINT UNSIGNED NULL,
  api_key_id BIGINT UNSIGNED NULL,
  user_id INT NULL,
  api_version VARCHAR(20) NOT NULL DEFAULT 'v1',
  endpoint VARCHAR(160) NOT NULL,
  method VARCHAR(12) NOT NULL,
  status_code INT NOT NULL,
  success TINYINT(1) NOT NULL DEFAULT 0,
  mode VARCHAR(20) NOT NULL DEFAULT 'sandbox',
  permission_used VARCHAR(60) NULL,
  ip_address VARCHAR(80) NULL,
  origin VARCHAR(255) NULL,
  user_agent VARCHAR(500) NULL,
  request_id VARCHAR(80) NULL,
  error_message VARCHAR(255) NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_developer_api_requests_app_time (application_id, created_at),
  KEY idx_developer_api_requests_key_time (api_key_id, created_at),
  KEY idx_developer_api_requests_endpoint (endpoint, created_at),
  KEY idx_developer_api_requests_request_id (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS developer_webhooks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id BIGINT UNSIGNED NOT NULL,
  user_id INT NOT NULL,
  url VARCHAR(500) NOT NULL,
  secret VARCHAR(120) NOT NULL,
  events JSON NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_developer_webhooks_app (application_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS developer_webhook_deliveries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  webhook_id BIGINT UNSIGNED NULL,
  application_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(80) NOT NULL,
  payload JSON NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NULL,
  response_status INT NULL,
  response_body TEXT NULL,
  error_message VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_developer_webhook_delivery_retry (status, next_attempt_at),
  KEY idx_developer_webhook_delivery_app (application_id, created_at),
  KEY idx_developer_webhook_delivery_event (event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS developer_sandbox_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  external_user_id VARCHAR(160) NULL,
  request_id VARCHAR(80) NULL,
  payload JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_developer_sandbox_app (application_id, created_at),
  KEY idx_developer_sandbox_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS developer_postback_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(80) NOT NULL,
  external_id VARCHAR(160) NULL,
  payload JSON NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'accepted',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_developer_postbacks_app (application_id, created_at),
  KEY idx_developer_postbacks_external (external_id, event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO developer_platform_settings (`key`, value, description) VALUES
  ('rate_limit_per_minute', '100', 'Default API requests per minute per private key'),
  ('rate_limit_per_hour', '1000', 'Default API requests per hour per private key'),
  ('rate_limit_per_day', '10000', 'Default API requests per day per private key'),
  ('api_v1_enabled', '1', 'Enable AdsGalaxy public API v1'),
  ('sandbox_mode_enabled', '1', 'Allow developer sandbox mode'),
  ('webhook_retry_max_attempts', '5', 'Maximum webhook delivery attempts'),
  ('webhook_retry_delay_minutes', '10', 'Minutes before retrying a failed webhook')
ON DUPLICATE KEY UPDATE value = value;
