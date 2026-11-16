-- Additive infrastructure only. No channel, campaign, balance or settlement mutations.
CREATE TABLE IF NOT EXISTS telegram_request_coordination (
  scope_key VARCHAR(96) NOT NULL PRIMARY KEY,
  cooldown_until_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  next_request_at_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_error_code VARCHAR(64) NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS telegram_request_cache (
  scope_key VARCHAR(96) NOT NULL,
  request_key CHAR(64) NOT NULL,
  response_json LONGTEXT NOT NULL CHECK (JSON_VALID(response_json)),
  expires_at_ms BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(scope_key,request_key), KEY idx_telegram_cache_expiry(expires_at_ms)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS channel_telegram_access_observations (
  channel_id INT NOT NULL PRIMARY KEY,
  last_attempt_state VARCHAR(32) NOT NULL,
  last_attempt_code VARCHAR(64) NULL,
  last_attempt_reason VARCHAR(500) NULL,
  last_attempt_source VARCHAR(64) NOT NULL,
  last_attempt_at DATETIME(6) NOT NULL,
  next_retry_at DATETIME(6) NULL,
  last_successful_verification_at DATETIME(6) NULL,
  publisher_authorized_at DATETIME(6) NULL,
  publisher_telegram_id VARCHAR(32) NULL,
  publisher_authorized_chat_id VARCHAR(64) NULL,
  approval_key CHAR(36) NULL,
  KEY idx_channel_attempt_retry(next_retry_at)
) ENGINE=InnoDB;
