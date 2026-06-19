-- AdsGalaxy / AdsFusion production upgrade preparation.
-- Purpose: add backward-compatible database fields for future scheduling,
-- deletion tracking, budget exhaustion, pause locking, emergency actions,
-- and admin audit/history.
--
-- Safe to re-run: uses IF NOT EXISTS where MariaDB supports it.
-- This migration intentionally does not change existing business logic.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS paused_at DATETIME NULL AFTER status,
  ADD COLUMN IF NOT EXISTS resume_locked_until DATETIME NULL AFTER paused_at,
  ADD COLUMN IF NOT EXISTS completed_at DATETIME NULL AFTER resume_locked_until,
  ADD COLUMN IF NOT EXISTS budget_exhausted_at DATETIME NULL AFTER completed_at,
  ADD COLUMN IF NOT EXISTS pause_reason VARCHAR(255) NULL AFTER budget_exhausted_at,
  ADD COLUMN IF NOT EXISTS auto_reactivate TINYINT(1) NOT NULL DEFAULT 1 AFTER pause_reason;

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS posting_times JSON NULL AFTER posts_per_day;

ALTER TABLE campaign_posts
  ADD COLUMN IF NOT EXISTS posting_slot_date DATE NULL AFTER status,
  ADD COLUMN IF NOT EXISTS posting_slot_time TIME NULL AFTER posting_slot_date,
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL AFTER posting_slot_time,
  ADD COLUMN IF NOT EXISTS delete_attempts INT NOT NULL DEFAULT 0 AFTER deleted_at,
  ADD COLUMN IF NOT EXISTS delete_failed_reason TEXT NULL AFTER delete_attempts;

CREATE TABLE IF NOT EXISTS admin_action_audits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id INT NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id BIGINT NULL,
  reason VARCHAR(255) NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_admin_action_audits_admin_created (admin_id, created_at),
  KEY idx_admin_action_audits_entity_created (entity_type, entity_id, created_at),
  KEY idx_admin_action_audits_action_created (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS campaign_delivery_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id INT NOT NULL,
  channel_id INT NULL,
  campaign_post_id INT NULL,
  event_type VARCHAR(50) NOT NULL,
  score DECIMAL(18,8) NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_campaign_delivery_events_campaign_created (campaign_id, created_at),
  KEY idx_campaign_delivery_events_channel_created (channel_id, created_at),
  KEY idx_campaign_delivery_events_type_created (event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS idx_campaign_posts_campaign_channel_created
  ON campaign_posts (campaign_id, channel_id, created_at);

CREATE INDEX IF NOT EXISTS idx_campaign_posts_channel_created
  ON campaign_posts (channel_id, created_at);

CREATE INDEX IF NOT EXISTS idx_campaign_posts_status_created
  ON campaign_posts (status, created_at);

CREATE INDEX IF NOT EXISTS idx_campaign_posts_slot
  ON campaign_posts (channel_id, posting_slot_date, posting_slot_time);

CREATE INDEX IF NOT EXISTS idx_campaigns_status_budget
  ON campaigns (status, budget);

CREATE INDEX IF NOT EXISTS idx_campaigns_resume_lock
  ON campaigns (status, resume_locked_until);

CREATE INDEX IF NOT EXISTS idx_channels_status_deleted
  ON channels (status, is_deleted);
