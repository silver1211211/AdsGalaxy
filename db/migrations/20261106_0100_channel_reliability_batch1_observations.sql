-- AdsGalaxy Channel Reliability Batch 1 (Problems 1, 2, and 4)
-- Forward-compatible schema ensure for temporary delivery backoff and Telegram access observations.
-- Safe to run on databases that already applied 20261030_0900_channel_telegram_coordination.sql.

CREATE TABLE IF NOT EXISTS channel_telegram_access_observations (
  channel_id INT NOT NULL,
  last_attempt_state VARCHAR(32) NOT NULL DEFAULT 'unchecked',
  last_attempt_code VARCHAR(64) DEFAULT NULL,
  last_attempt_reason VARCHAR(500) DEFAULT NULL,
  last_attempt_source VARCHAR(64) NOT NULL DEFAULT 'unknown',
  last_attempt_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  next_retry_at DATETIME(6) DEFAULT NULL,
  last_successful_verification_at DATETIME(6) DEFAULT NULL,
  publisher_authorized_at DATETIME(6) DEFAULT NULL,
  publisher_telegram_id VARCHAR(32) DEFAULT NULL,
  publisher_authorized_chat_id VARCHAR(64) DEFAULT NULL,
  approval_key CHAR(36) DEFAULT NULL,
  PRIMARY KEY (channel_id),
  KEY idx_channel_telegram_access_obs_retry (next_retry_at),
  KEY idx_channel_telegram_access_obs_state (last_attempt_state, last_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE channel_telegram_identities
  ADD INDEX IF NOT EXISTS idx_channel_telegram_identities_next_retry_channel (next_retry_at, channel_id);
