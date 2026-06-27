-- Phase 13C: bot/channel health monitoring and active count accuracy.
-- Additive only. Does not modify CPM, referral, SDK, Mini App, billing, payout, or broadcast structure.

ALTER TABLE bots
  ADD COLUMN IF NOT EXISTS paused_reason VARCHAR(255) NULL AFTER status,
  ADD COLUMN IF NOT EXISTS suggested_fix VARCHAR(255) NULL AFTER paused_reason,
  ADD COLUMN IF NOT EXISTS health_status VARCHAR(40) NULL AFTER suggested_fix,
  ADD COLUMN IF NOT EXISTS health_checked_at DATETIME NULL AFTER health_status,
  ADD COLUMN IF NOT EXISTS last_successful_broadcast_at DATETIME NULL AFTER health_checked_at,
  ADD COLUMN IF NOT EXISTS last_failure_at DATETIME NULL AFTER last_successful_broadcast_at,
  ADD COLUMN IF NOT EXISTS failure_reason VARCHAR(255) NULL AFTER last_failure_at,
  ADD COLUMN IF NOT EXISTS auto_paused_at DATETIME NULL AFTER failure_reason,
  ADD COLUMN IF NOT EXISTS reactivated_at DATETIME NULL AFTER auto_paused_at;

ALTER TABLE bot_users
  ADD COLUMN IF NOT EXISTS status VARCHAR(40) NOT NULL DEFAULT 'active' AFTER is_active,
  ADD COLUMN IF NOT EXISTS inactive_reason VARCHAR(255) NULL AFTER status,
  ADD COLUMN IF NOT EXISTS last_health_failure_at DATETIME NULL AFTER inactive_reason,
  ADD COLUMN IF NOT EXISTS last_successful_delivery_at DATETIME NULL AFTER last_health_failure_at;

CREATE INDEX IF NOT EXISTS idx_bots_health_status
  ON bots (status, is_deleted, health_status);

CREATE INDEX IF NOT EXISTS idx_bot_users_active_status
  ON bot_users (bot_id, is_active, status);

UPDATE bot_users SET status = 'active' WHERE is_active = TRUE AND (status IS NULL OR status = '');
UPDATE bot_users SET status = 'inactive' WHERE is_active = FALSE AND (status IS NULL OR status = 'active');
