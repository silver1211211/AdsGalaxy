-- Critical Fix Sprint #1: revenue validation, reward verification, cron locks, and post consistency.

ALTER TABLE miniapp_daily_stats
  ADD COLUMN IF NOT EXISTS revenue_validation_status VARCHAR(30) NOT NULL DEFAULT 'unvalidated' AFTER publisher_revenue,
  ADD COLUMN IF NOT EXISTS revenue_validation_reason VARCHAR(255) NULL AFTER revenue_validation_status,
  ADD COLUMN IF NOT EXISTS revenue_validation_metadata JSON NULL AFTER revenue_validation_reason,
  ADD COLUMN IF NOT EXISTS revenue_validated_at DATETIME NULL AFTER revenue_validation_metadata,
  ADD KEY IF NOT EXISTS idx_miniapp_daily_stats_revenue_validation (revenue_validation_status, date);

CREATE TABLE IF NOT EXISTS miniapp_network_revenue_limits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  network_name VARCHAR(50) NOT NULL,
  min_gross_cpm DECIMAL(18,8) NOT NULL DEFAULT 0,
  max_gross_cpm DECIMAL(18,8) NOT NULL DEFAULT 60,
  suspicious_gross_cpm DECIMAL(18,8) NOT NULL DEFAULT 30,
  max_revenue_per_impression DECIMAL(18,8) NOT NULL DEFAULT 0.06,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_network_revenue_limits (network_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO miniapp_network_revenue_limits
  (network_name, min_gross_cpm, max_gross_cpm, suspicious_gross_cpm, max_revenue_per_impression)
VALUES
  ('AdsGram', 0, 80, 35, 0.08),
  ('Monetag', 0, 80, 35, 0.08),
  ('RichAds', 0, 80, 35, 0.08),
  ('AdExium', 0, 80, 35, 0.08),
  ('GigaPub', 0, 80, 35, 0.08),
  ('AdsGalaxyInternal', 0, 100, 60, 0.10)
ON DUPLICATE KEY UPDATE
  max_gross_cpm = VALUES(max_gross_cpm),
  suspicious_gross_cpm = VALUES(suspicious_gross_cpm),
  max_revenue_per_impression = VALUES(max_revenue_per_impression);

ALTER TABLE miniapp_mediation_requests
  ADD COLUMN IF NOT EXISTS reward_verified_at DATETIME NULL AFTER impression_confirmed_at,
  ADD COLUMN IF NOT EXISTS reward_verification_status VARCHAR(30) NULL AFTER reward_verified_at,
  ADD COLUMN IF NOT EXISTS reward_verification_payload JSON NULL AFTER reward_verification_status,
  ADD KEY IF NOT EXISTS idx_mediation_reward_verification (reward_verification_status, reward_verified_at);

CREATE TABLE IF NOT EXISTS developer_reward_verifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id BIGINT UNSIGNED NOT NULL,
  request_id VARCHAR(80) NOT NULL,
  external_user_id VARCHAR(120) NOT NULL,
  reward_id VARCHAR(120) NULL,
  eligible TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL,
  payload JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_developer_reward_request (request_id),
  KEY idx_developer_reward_app_user (application_id, external_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cron_locks (
  lock_name VARCHAR(120) NOT NULL,
  locked_until DATETIME NOT NULL,
  owner_token VARCHAR(80) NOT NULL,
  acquired_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (lock_name),
  KEY idx_cron_locks_locked_until (locked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE campaign_posts
  ADD COLUMN IF NOT EXISTS delivery_attempted_at DATETIME NULL AFTER message_id,
  ADD COLUMN IF NOT EXISTS delivery_confirmed_at DATETIME NULL AFTER delivery_attempted_at,
  ADD COLUMN IF NOT EXISTS delivery_failed_at DATETIME NULL AFTER delivery_confirmed_at,
  ADD COLUMN IF NOT EXISTS delivery_failure_reason VARCHAR(255) NULL AFTER delivery_failed_at,
  ADD KEY IF NOT EXISTS idx_campaign_posts_delivery_state (status, delivery_confirmed_at, delivery_failed_at);
