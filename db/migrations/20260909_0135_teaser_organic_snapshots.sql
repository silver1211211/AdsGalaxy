CREATE TABLE IF NOT EXISTS channel_organic_posts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  channel_id BIGINT NOT NULL,
  publisher_id BIGINT NOT NULL,
  telegram_chat_id BIGINT NOT NULL,
  telegram_message_id BIGINT NOT NULL,
  message_type ENUM('text','photo','video') NOT NULL,
  organic_text MEDIUMTEXT NOT NULL,
  entities JSON NULL,
  caption_entities JSON NULL,
  media_group_id VARCHAR(128) NULL,
  posted_at DATETIME NOT NULL,
  last_organic_edit_at DATETIME NULL,
  last_seen_update_id BIGINT NOT NULL,
  availability ENUM('available','deleted','unavailable') NOT NULL DEFAULT 'available',
  teaser_eligible TINYINT(1) NOT NULL DEFAULT 1,
  eligibility_reason VARCHAR(64) NULL,
  content_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY(id),
  UNIQUE KEY uq_channel_organic_message(telegram_chat_id,telegram_message_id),
  KEY idx_channel_organic_recent(channel_id,availability,teaser_eligible,telegram_message_id),
  KEY idx_channel_organic_retention(channel_id,posted_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE teaser_placements
  ADD COLUMN IF NOT EXISTS organic_post_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS emergency_job_id BIGINT UNSIGNED NULL,
  ADD INDEX IF NOT EXISTS idx_teaser_organic_post(organic_post_id),
  ADD UNIQUE INDEX IF NOT EXISTS uq_teaser_emergency_identity(emergency_job_id,campaign_id,channel_id,telegram_message_id);

CREATE TABLE IF NOT EXISTS teaser_emergency_job_channels (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id BIGINT UNSIGNED NOT NULL,
  campaign_id BIGINT NOT NULL,
  channel_id BIGINT NOT NULL,
  organic_post_id BIGINT UNSIGNED NULL,
  telegram_message_id BIGINT NULL,
  status ENUM('queued','processing','injected','skipped','failed','retrying') NOT NULL DEFAULT 'queued',
  reason_code VARCHAR(64) NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_retry_at DATETIME NULL,
  placement_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY(id),
  UNIQUE KEY uq_teaser_emergency_channel(job_id,channel_id),
  KEY idx_teaser_emergency_work(status,next_retry_at,id),
  KEY idx_teaser_emergency_reason(job_id,status,reason_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE teaser_emergency_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128) NULL,
  ADD COLUMN IF NOT EXISTS targeting_snapshot JSON NULL,
  ADD COLUMN IF NOT EXISTS discovery_complete TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lease_until DATETIME NULL,
  ADD UNIQUE INDEX IF NOT EXISTS uq_teaser_emergency_idempotency(admin_id,idempotency_key);
