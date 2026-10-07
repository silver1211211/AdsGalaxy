-- System-hardening follow-up to already-applied 0154/0155. DO NOT apply from this source-only change.
ALTER TABLE miniapp_external_delivery_syncs
  MODIFY COLUMN status VARCHAR(64) NOT NULL DEFAULT 'scheduled';

-- Persist identity-reconciliation retries so terminal/manual-review cases cannot spin.
ALTER TABLE channel_telegram_identities
  ADD COLUMN IF NOT EXISTS reconciliation_last_attempt_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS reconciliation_next_retry_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS reconciliation_failure_code VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS reconciliation_attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reconciliation_state VARCHAR(32) NOT NULL DEFAULT 'pending',
  ADD KEY IF NOT EXISTS idx_channel_identity_reconciliation (reconciliation_state, reconciliation_next_retry_at, id);
