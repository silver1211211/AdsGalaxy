ALTER TABLE channel_telegram_identities
  ADD COLUMN IF NOT EXISTS verification_state VARCHAR(32) NOT NULL DEFAULT 'unknown' AFTER bot_can_post,
  ADD COLUMN IF NOT EXISTS consecutive_failure_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER verification_state,
  ADD COLUMN IF NOT EXISTS first_failure_at DATETIME(6) NULL AFTER consecutive_failure_count,
  ADD COLUMN IF NOT EXISTS last_failure_at DATETIME(6) NULL AFTER first_failure_at,
  ADD COLUMN IF NOT EXISTS last_success_at DATETIME(6) NULL AFTER last_failure_at,
  ADD COLUMN IF NOT EXISTS last_checked_at DATETIME(6) NULL AFTER last_success_at,
  ADD COLUMN IF NOT EXISTS next_retry_at DATETIME(6) NULL AFTER last_checked_at,
  ADD COLUMN IF NOT EXISTS last_check_source VARCHAR(32) NULL AFTER next_retry_at,
  ADD INDEX IF NOT EXISTS idx_channel_identity_due (next_retry_at, last_checked_at),
  ADD INDEX IF NOT EXISTS idx_channel_identity_state (verification_state, consecutive_failure_count);

UPDATE channel_telegram_identities
SET last_success_at = COALESCE(last_success_at, last_verified_at),
    last_checked_at = COALESCE(last_checked_at, last_verified_at),
    verification_state = CASE
      WHEN bot_can_post = 1 THEN 'healthy'
      WHEN last_failure_code IS NOT NULL THEN last_failure_code
      ELSE verification_state
    END;
