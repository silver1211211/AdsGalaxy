CREATE TABLE IF NOT EXISTS referral_reward_reversals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  idempotency_key VARCHAR(191) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  referral_id BIGINT UNSIGNED NOT NULL,
  original_reward_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(20,8) NOT NULL,
  currency CHAR(4) NOT NULL DEFAULT 'USDT',
  reason VARCHAR(255) NOT NULL,
  old_balance DECIMAL(20,8) NOT NULL,
  new_balance DECIMAL(20,8) NOT NULL,
  actor VARCHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id), UNIQUE KEY uq_referral_reward_reversal_key (idempotency_key),
  UNIQUE KEY uq_referral_reward_reversal_reward (original_reward_id),
  KEY idx_referral_reward_reversal_user (user_id,created_at),
  CONSTRAINT chk_referral_reward_reversal_amount CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS subscribers_last_success_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS subscribers_last_attempt_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS subscribers_fetch_status VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS subscribers_fetch_error_code VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS subscribers_consecutive_failures INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS below_minimum_since DATETIME NULL,
  ADD COLUMN IF NOT EXISTS below_minimum_success_count INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monetization_paused_reason VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS monetization_auto_paused_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS monetization_auto_restored_at DATETIME NULL,
  ADD KEY IF NOT EXISTS idx_channels_subscriber_refresh (subscribers_last_attempt_at,id);
