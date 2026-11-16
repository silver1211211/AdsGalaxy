-- AdsGalaxy Channel Reliability Batch 4 (Problems 10 and 11)
-- Part 1: Forward-compatible view-fetch metadata and UTC timestamp tracking on campaign_posts.
-- Part 2: Complete append-only channel status transition audit ledger with idempotency protection.

ALTER TABLE campaign_posts
  ADD COLUMN IF NOT EXISTS last_views_update_at DATETIME(6) NULL AFTER last_views_update,
  ADD COLUMN IF NOT EXISTS view_fetch_failures INT UNSIGNED NOT NULL DEFAULT 0 AFTER view_fetch_source,
  ADD COLUMN IF NOT EXISTS last_view_failure_class VARCHAR(32) NULL AFTER view_fetch_failures,
  ADD COLUMN IF NOT EXISTS view_next_retry_at DATETIME(6) NULL AFTER last_view_failure_class,
  ADD COLUMN IF NOT EXISTS last_view_attempt_at DATETIME(6) NULL AFTER view_next_retry_at,
  ADD INDEX IF NOT EXISTS idx_campaign_posts_view_retry_due (status, view_fetch_status, view_next_retry_at, id);

CREATE TABLE IF NOT EXISTS channel_status_transition_audits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  idempotency_key VARCHAR(191) NOT NULL,
  channel_id INT NOT NULL,
  telegram_chat_id VARCHAR(64) NULL,
  previous_status VARCHAR(40) NOT NULL,
  new_status VARCHAR(40) NOT NULL,
  transitioned_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  source_worker VARCHAR(80) NOT NULL,
  reason_code VARCHAR(80) NOT NULL,
  reason_text VARCHAR(500) NOT NULL,
  evidence_classification VARCHAR(32) NOT NULL DEFAULT 'none',
  verification_attempt_ref VARCHAR(128) NULL,
  actor_type VARCHAR(32) NOT NULL DEFAULT 'system',
  actor_id BIGINT NULL,
  transition_intent VARCHAR(32) NOT NULL DEFAULT 'automatic',
  verification_version INT UNSIGNED NULL,
  recovery_action VARCHAR(64) NULL,
  recovery_outcome VARCHAR(64) NULL,
  notification_generated TINYINT(1) NOT NULL DEFAULT 0,
  metadata LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(metadata)),
  PRIMARY KEY (id),
  UNIQUE KEY uq_channel_status_transition_idempotency (idempotency_key),
  KEY idx_channel_status_transition_channel_time (channel_id, transitioned_at),
  KEY idx_channel_status_transition_status_time (new_status, transitioned_at),
  KEY idx_channel_status_transition_source_time (source_worker, transitioned_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
