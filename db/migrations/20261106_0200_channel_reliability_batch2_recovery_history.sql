-- AdsGalaxy Channel Reliability Batch 2: Verification History Preservation & Controlled Automatic Channel Recovery
-- Forward-compatible migration for isolated release candidate validation.
-- Preserves confirmed historical administrator evidence across failed checks and tracks controlled recovery progress.

ALTER TABLE channel_telegram_identities
  ADD COLUMN IF NOT EXISTS last_confirmed_bot_member_status VARCHAR(32) NULL AFTER bot_can_post,
  ADD COLUMN IF NOT EXISTS last_confirmed_bot_can_post TINYINT(1) NULL AFTER last_confirmed_bot_member_status,
  ADD COLUMN IF NOT EXISTS last_confirmed_at DATETIME(6) NULL AFTER last_confirmed_bot_can_post,
  ADD COLUMN IF NOT EXISTS last_evidence_category VARCHAR(32) NULL AFTER verification_state,
  ADD COLUMN IF NOT EXISTS last_status_transition_from VARCHAR(32) NULL AFTER last_check_source,
  ADD COLUMN IF NOT EXISTS last_status_transition_to VARCHAR(32) NULL AFTER last_status_transition_from,
  ADD COLUMN IF NOT EXISTS last_status_transition_reason VARCHAR(255) NULL AFTER last_status_transition_to,
  ADD COLUMN IF NOT EXISTS last_status_transition_actor VARCHAR(64) NULL AFTER last_status_transition_reason,
  ADD COLUMN IF NOT EXISTS last_status_transition_at DATETIME(6) NULL AFTER last_status_transition_actor,
  ADD COLUMN IF NOT EXISTS recovery_claim_owner VARCHAR(64) NULL AFTER last_status_transition_at,
  ADD COLUMN IF NOT EXISTS recovery_claim_expires_at DATETIME(6) NULL AFTER recovery_claim_owner,
  ADD COLUMN IF NOT EXISTS recovery_attempt_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER recovery_claim_expires_at,
  ADD COLUMN IF NOT EXISTS last_recovery_attempt_at DATETIME(6) NULL AFTER recovery_attempt_count,
  ADD COLUMN IF NOT EXISTS last_recovery_outcome VARCHAR(64) NULL AFTER last_recovery_attempt_at,
  ADD INDEX IF NOT EXISTS idx_channel_identity_recovery_priority (bot_can_post, last_verified_at, next_retry_at, channel_id),
  ADD INDEX IF NOT EXISTS idx_channel_identity_recovery_claim (recovery_claim_expires_at, channel_id);

UPDATE channel_telegram_identities
-- Only backfill from explicit stored Telegram membership evidence. A bare `last_verified_at` is NOT proof of
-- administrator rights, so nothing is ever inferred as 'administrator' / can_post = 1 from it.
SET last_confirmed_bot_member_status = COALESCE(last_confirmed_bot_member_status, CASE
      WHEN bot_member_status IN ('administrator','creator','member','restricted','left','kicked') THEN bot_member_status
      ELSE NULL END),
    last_confirmed_bot_can_post = COALESCE(last_confirmed_bot_can_post, CASE
      WHEN bot_can_post = 1 AND bot_member_status IN ('administrator','creator') THEN 1
      ELSE NULL END),
    last_confirmed_at = COALESCE(last_confirmed_at, CASE
      WHEN bot_member_status IN ('administrator','creator','member','restricted','left','kicked') THEN last_verified_at
      ELSE NULL END),
    last_evidence_category = COALESCE(last_evidence_category, CASE
      WHEN verification_state = 'healthy' THEN 'confirmed'
      WHEN verification_state IN ('bot_removed', 'permission_missing', 'restricted', 'identity_mismatch') THEN 'confirmed'
      WHEN last_failure_code IN ('chat_not_found_unconfirmed', 'member_list_inaccessible') THEN 'uncertain'
      WHEN last_failure_code IS NOT NULL THEN 'temporary'
      ELSE NULL
    END)
WHERE last_confirmed_at IS NULL OR last_evidence_category IS NULL;

ALTER TABLE channel_telegram_access_observations
  ADD COLUMN IF NOT EXISTS evidence_category VARCHAR(32) NULL AFTER last_attempt_state,
  ADD COLUMN IF NOT EXISTS last_confirmed_bot_member_status VARCHAR(32) NULL AFTER last_successful_verification_at,
  ADD COLUMN IF NOT EXISTS last_confirmed_bot_can_post TINYINT(1) NULL AFTER last_confirmed_bot_member_status,
  ADD COLUMN IF NOT EXISTS previous_channel_status VARCHAR(32) NULL AFTER approval_key,
  ADD COLUMN IF NOT EXISTS new_channel_status VARCHAR(32) NULL AFTER previous_channel_status,
  ADD COLUMN IF NOT EXISTS status_change_reason VARCHAR(255) NULL AFTER new_channel_status,
  ADD COLUMN IF NOT EXISTS actor_worker VARCHAR(64) NULL AFTER status_change_reason;

CREATE TABLE IF NOT EXISTS channel_recovery_checkpoints (
  cursor_key VARCHAR(64) NOT NULL,
  last_channel_id INT NOT NULL DEFAULT 0,
  worker_id VARCHAR(64) NULL,
  total_processed INT UNSIGNED NOT NULL DEFAULT 0,
  total_recovered INT UNSIGNED NOT NULL DEFAULT 0,
  total_skipped INT UNSIGNED NOT NULL DEFAULT 0,
  total_deferred INT UNSIGNED NOT NULL DEFAULT 0,
  last_rate_limited_until DATETIME(6) NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (cursor_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE channel_recovery_checkpoints
  ADD COLUMN IF NOT EXISTS total_checked INT UNSIGNED NOT NULL DEFAULT 0 AFTER total_processed,
  ADD COLUMN IF NOT EXISTS total_rate_limited INT UNSIGNED NOT NULL DEFAULT 0 AFTER total_deferred,
  ADD COLUMN IF NOT EXISTS total_manual_review INT UNSIGNED NOT NULL DEFAULT 0 AFTER total_rate_limited,
  ADD COLUMN IF NOT EXISTS wrap_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER total_manual_review;

CREATE TABLE IF NOT EXISTS channel_recovery_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  channel_id INT NOT NULL,
  worker_id VARCHAR(64) NOT NULL,
  previous_status VARCHAR(32) NOT NULL,
  new_status VARCHAR(32) NOT NULL,
  outcome VARCHAR(64) NOT NULL,
  reason_code VARCHAR(64) NULL,
  decision_reason VARCHAR(255) NULL,
  evidence_category VARCHAR(32) NULL,
  bot_member_status VARCHAR(32) NULL,
  can_post_messages TINYINT(1) NOT NULL DEFAULT 0,
  had_prior_verified_evidence TINYINT(1) NOT NULL DEFAULT 0,
  retry_after_seconds INT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_channel_recovery_attempts_channel (channel_id, created_at),
  KEY idx_channel_recovery_attempts_outcome (outcome, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
