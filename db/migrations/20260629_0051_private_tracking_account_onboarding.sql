-- Private channel tracking account onboarding.
-- Stores safe assignment/status metadata only. No MTProto sessions, phones, API hashes, bot tokens, or invite links are stored.

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS tracking_account_status ENUM('not_required', 'active', 'pending_manual', 'failed', 'removed') NOT NULL DEFAULT 'not_required' AFTER view_tracking_status,
  ADD COLUMN IF NOT EXISTS tracking_account TINYINT UNSIGNED NULL AFTER tracking_account_status,
  ADD COLUMN IF NOT EXISTS tracking_account_member_status VARCHAR(40) NULL AFTER tracking_account,
  ADD COLUMN IF NOT EXISTS tracking_account_assigned_at DATETIME NULL AFTER tracking_account_member_status,
  ADD COLUMN IF NOT EXISTS tracking_account_last_success_at DATETIME NULL AFTER tracking_account_assigned_at,
  ADD COLUMN IF NOT EXISTS tracking_account_last_failure_at DATETIME NULL AFTER tracking_account_last_success_at,
  ADD COLUMN IF NOT EXISTS tracking_account_failure_reason VARCHAR(255) NULL AFTER tracking_account_last_failure_at;

UPDATE channels
SET tracking_account_status = CASE WHEN channel_type = 'private' THEN 'pending_manual' ELSE 'not_required' END
WHERE tracking_account_status IS NULL
   OR tracking_account_status = '';

CREATE INDEX IF NOT EXISTS idx_channels_tracking_account
  ON channels (channel_type, tracking_account_status, tracking_account, is_deleted);
