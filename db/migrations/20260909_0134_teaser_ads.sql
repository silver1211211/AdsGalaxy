ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS teaser_enabled TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS teaser_daily_limit TINYINT UNSIGNED NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS teaser_status ENUM('active','disabled','needs_permission') NOT NULL DEFAULT 'needs_permission',
  ADD COLUMN IF NOT EXISTS teaser_permission_checked_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS teaser_last_organic_message_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS teaser_last_placement_message_id BIGINT NULL,
  ADD INDEX IF NOT EXISTS idx_channels_teaser_inventory (teaser_enabled,teaser_status,status,is_deleted);

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS teaser_mode ENUM('none','standard_plus_teaser','teaser_only') NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS teaser_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS teaser_cta_key VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS teaser_cpm DECIMAL(20,8) NULL,
  ADD COLUMN IF NOT EXISTS teaser_paused_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS teaser_resume_locked_until DATETIME NULL,
  ADD INDEX IF NOT EXISTS idx_campaigns_teaser_match (teaser_enabled,teaser_mode,status,category);

ALTER TABLE advertiser_direct_debits
  MODIFY COLUMN billing_type ENUM('channel_view','channel_click','bot_delivery','miniapp_impression','miniapp_external','channel_growth','teaser_impression') NOT NULL;

CREATE TABLE IF NOT EXISTS teaser_creatives (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT NOT NULL,
  copy_text VARCHAR(320) NOT NULL,
  position TINYINT UNSIGNED NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uq_teaser_creative_position (campaign_id,position),
  KEY idx_teaser_creative_rotation (campaign_id,active,position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teaser_placements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_update_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  channel_id BIGINT NOT NULL,
  publisher_id BIGINT NOT NULL,
  teaser_creative_id BIGINT UNSIGNED NOT NULL,
  telegram_chat_id BIGINT NOT NULL,
  telegram_message_id BIGINT NOT NULL,
  message_type ENUM('text','photo','video','document','animation') NOT NULL,
  creative_snapshot VARCHAR(320) NOT NULL,
  cta_key VARCHAR(32) NOT NULL,
  teaser_cpm_snapshot DECIMAL(20,8) NOT NULL,
  tracking_token CHAR(43) NOT NULL,
  organic_text MEDIUMTEXT NOT NULL,
  organic_entities JSON NULL,
  rendered_suffix TEXT NOT NULL,
  rendered_entities JSON NOT NULL,
  rendered_content_hash CHAR(64) NOT NULL,
  baseline_views BIGINT UNSIGNED NULL,
  last_seen_views BIGINT UNSIGNED NULL,
  settled_impressions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  clicks BIGINT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('claimed','awaiting_baseline','active','removal_pending','removed','already_absent','failed') NOT NULL DEFAULT 'claimed',
  inserted_at DATETIME NULL,
  expires_at DATETIME NULL,
  removal_requested_at DATETIME NULL,
  removal_next_retry_at DATETIME NULL,
  removal_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  insertion_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  insertion_next_retry_at DATETIME NULL,
  removal_reason VARCHAR(64) NULL,
  removed_at DATETIME NULL,
  last_error_code VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_teaser_source_update (source_update_id),
  UNIQUE KEY uq_teaser_message (telegram_chat_id,telegram_message_id),
  UNIQUE KEY uq_teaser_tracking_token (tracking_token),
  KEY idx_teaser_active_expiry (status,expires_at,id),
  KEY idx_teaser_channel_daily (channel_id,inserted_at,id),
  KEY idx_teaser_campaign_stats (campaign_id,status,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teaser_settlements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  placement_id BIGINT UNSIGNED NOT NULL,
  checkpoint_views BIGINT UNSIGNED NOT NULL,
  impression_delta BIGINT UNSIGNED NOT NULL,
  gross_amount DECIMAL(20,8) NOT NULL,
  publisher_amount DECIMAL(20,8) NOT NULL,
  platform_amount DECIMAL(20,8) NOT NULL,
  reserve_amount DECIMAL(20,8) NOT NULL,
  publisher_quality_score DECIMAL(8,4) NOT NULL DEFAULT 100,
  publisher_quality_weight DECIMAL(8,6) NOT NULL DEFAULT 1,
  quality_holdback DECIMAL(20,8) NOT NULL DEFAULT 0,
  direct_debit_source_key VARCHAR(191) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uq_teaser_settlement_checkpoint (placement_id,checkpoint_views),
  UNIQUE KEY uq_teaser_settlement_debit (direct_debit_source_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teaser_clicks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,placement_id BIGINT UNSIGNED NOT NULL,fingerprint CHAR(64) NOT NULL,bucket_start DATETIME NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(id),UNIQUE KEY uq_teaser_click_window(placement_id,fingerprint,bucket_start),KEY idx_teaser_click_created(created_at,placement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teaser_rollout_notifications (
  publisher_id BIGINT NOT NULL, status ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0, next_retry_at DATETIME NULL, sent_at DATETIME NULL,
  last_error_code VARCHAR(64) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (publisher_id), KEY idx_teaser_rollout_queue (status,next_retry_at,publisher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teaser_emergency_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, campaign_id BIGINT NOT NULL, admin_id BIGINT NOT NULL,
  status ENUM('queued','running','completed','failed') NOT NULL DEFAULT 'queued',
  eligible_count INT UNSIGNED NOT NULL DEFAULT 0, queued_count INT UNSIGNED NOT NULL DEFAULT 0,
  injected_count INT UNSIGNED NOT NULL DEFAULT 0, skipped_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed_count INT UNSIGNED NOT NULL DEFAULT 0, retrying_count INT UNSIGNED NOT NULL DEFAULT 0,
  cursor_channel_id BIGINT UNSIGNED NOT NULL DEFAULT 0, last_error_code VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, started_at DATETIME NULL, completed_at DATETIME NULL,
  PRIMARY KEY(id), KEY idx_teaser_emergency_queue(status,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO settings (`key`,value) VALUES
 ('teaser_enabled','1'),('teaser_min_cpm','0.50'),('teaser_recommended_cpm','0.89'),('teaser_max_cpm','6.50'),
 ('teaser_publisher_share','60'),('teaser_platform_share','30'),('teaser_reserve_share','10'),('teaser_min_post_spacing','2');

UPDATE channels SET teaser_enabled=1,teaser_daily_limit=5,
 teaser_status=CASE WHEN teaser_status='disabled' THEN 'needs_permission' ELSE teaser_status END
WHERE is_deleted=FALSE AND status IN ('active','approved');

INSERT IGNORE INTO teaser_rollout_notifications(publisher_id)
SELECT DISTINCT user_id FROM channels WHERE is_deleted=FALSE AND status IN ('active','approved');
