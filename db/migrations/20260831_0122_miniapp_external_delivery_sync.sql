-- Durable, source-separated Mini App external delivery synchronization.
-- Additive and safe to rerun on the production MariaDB schema.

ALTER TABLE miniapp_rewarded_campaigns
  ADD COLUMN IF NOT EXISTS budget_exhaustion_cycle INT UNSIGNED NOT NULL DEFAULT 0
    AFTER pause_reason;

CREATE TABLE IF NOT EXISTS miniapp_external_delivery_syncs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  admin_id INT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'scheduled',
  active_slot TINYINT UNSIGNED NULL DEFAULT 1,
  starting_platform_impressions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  starting_platform_clicks BIGINT UNSIGNED NOT NULL DEFAULT 0,
  starting_combined_impressions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  starting_combined_clicks BIGINT UNSIGNED NOT NULL DEFAULT 0,
  target_impressions BIGINT UNSIGNED NOT NULL,
  target_clicks BIGINT UNSIGNED NOT NULL,
  required_external_impressions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  required_external_clicks BIGINT UNSIGNED NOT NULL DEFAULT 0,
  platform_impressions_during BIGINT UNSIGNED NOT NULL DEFAULT 0,
  platform_clicks_during BIGINT UNSIGNED NOT NULL DEFAULT 0,
  external_impressions_added BIGINT UNSIGNED NOT NULL DEFAULT 0,
  external_clicks_added BIGINT UNSIGNED NOT NULL DEFAULT 0,
  external_spend DECIMAL(18,8) NOT NULL DEFAULT 0.00000000,
  duration_seconds INT UNSIGNED NOT NULL,
  started_at DATETIME NULL,
  ends_at DATETIME NULL,
  paused_at DATETIME NULL,
  total_paused_seconds INT UNSIGNED NOT NULL DEFAULT 0,
  last_processed_at DATETIME NULL,
  completed_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  stop_reason VARCHAR(80) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_miniapp_external_sync_active (campaign_id, active_slot),
  KEY idx_miniapp_external_sync_worker (status, ends_at, id),
  KEY idx_miniapp_external_sync_campaign_created (campaign_id, created_at),
  KEY idx_miniapp_external_sync_admin (admin_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS miniapp_external_delivery_batches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sync_id BIGINT UNSIGNED NOT NULL,
  campaign_id BIGINT UNSIGNED NOT NULL,
  progress_ratio DECIMAL(12,10) NOT NULL DEFAULT 0.0000000000,
  platform_impressions_snapshot BIGINT UNSIGNED NOT NULL DEFAULT 0,
  platform_clicks_snapshot BIGINT UNSIGNED NOT NULL DEFAULT 0,
  external_impressions_added BIGINT UNSIGNED NOT NULL DEFAULT 0,
  external_clicks_added BIGINT UNSIGNED NOT NULL DEFAULT 0,
  advertiser_debit DECIMAL(18,8) NOT NULL DEFAULT 0.00000000,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_miniapp_external_batch_sync (sync_id, id),
  KEY idx_miniapp_external_batch_campaign_created (campaign_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS miniapp_campaign_notification_outbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  exhaustion_cycle INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error VARCHAR(255) NULL,
  sent_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_miniapp_campaign_notification (campaign_id, event_type, exhaustion_cycle),
  KEY idx_miniapp_campaign_notification_pending (status, next_attempt_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
