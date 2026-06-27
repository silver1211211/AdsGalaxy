-- Phase 13B: channel scheduler, lifecycle, health, and active channel accounting.
-- Additive only. Does not modify CPM, referral, SDK, Mini App, bot broadcast, or payout logic.

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS scheduler_slot VARCHAR(5) NULL AFTER posting_times,
  ADD COLUMN IF NOT EXISTS scheduler_slot_index SMALLINT UNSIGNED NULL AFTER scheduler_slot,
  ADD COLUMN IF NOT EXISTS schedule_mode VARCHAR(30) NOT NULL DEFAULT 'default' AFTER scheduler_slot_index,
  ADD COLUMN IF NOT EXISTS posting_window_start VARCHAR(5) NULL AFTER schedule_mode,
  ADD COLUMN IF NOT EXISTS posting_window_end VARCHAR(5) NULL AFTER posting_window_start,
  ADD COLUMN IF NOT EXISTS admin_schedule_override JSON NULL AFTER posting_window_end,
  ADD COLUMN IF NOT EXISTS paused_reason VARCHAR(255) NULL AFTER status,
  ADD COLUMN IF NOT EXISTS suggested_fix VARCHAR(255) NULL AFTER paused_reason,
  ADD COLUMN IF NOT EXISTS last_successful_post_at DATETIME NULL AFTER suggested_fix,
  ADD COLUMN IF NOT EXISTS last_failure_at DATETIME NULL AFTER last_successful_post_at,
  ADD COLUMN IF NOT EXISTS failure_reason VARCHAR(255) NULL AFTER last_failure_at,
  ADD COLUMN IF NOT EXISTS health_checked_at DATETIME NULL AFTER failure_reason,
  ADD COLUMN IF NOT EXISTS health_status VARCHAR(40) NULL AFTER health_checked_at,
  ADD COLUMN IF NOT EXISTS auto_paused_at DATETIME NULL AFTER health_status,
  ADD COLUMN IF NOT EXISTS reactivated_at DATETIME NULL AFTER auto_paused_at;

CREATE INDEX IF NOT EXISTS idx_channels_scheduler_slot
  ON channels (status, is_deleted, scheduler_slot);

CREATE INDEX IF NOT EXISTS idx_channels_health_status
  ON channels (health_status, last_failure_at);

CREATE TABLE IF NOT EXISTS channel_scheduler_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slot_date DATE NOT NULL,
  slot_time TIME NOT NULL,
  assigned_channels INT NOT NULL DEFAULT 0,
  attempted INT NOT NULL DEFAULT 0,
  successful INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  auto_paused INT NOT NULL DEFAULT 0,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_channel_scheduler_runs_slot (slot_date, slot_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
