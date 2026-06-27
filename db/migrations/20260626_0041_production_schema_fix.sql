-- Production schema fix: idempotent catch-up migration.
-- Safe to run regardless of which prior migrations were applied.
-- All statements use IF NOT EXISTS guards.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. miniapp_ad_networks — priority_order (from 0008, no IF NOT EXISTS guard)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE miniapp_ad_networks
  ADD COLUMN IF NOT EXISTS priority_order INT NOT NULL DEFAULT 0 AFTER enabled;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. miniapp_mediation_requests — fallback/decision columns (from 0008)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE miniapp_mediation_requests
  ADD COLUMN IF NOT EXISTS parent_request_id VARCHAR(64) NULL AFTER request_id,
  ADD COLUMN IF NOT EXISTS root_request_id VARCHAR(64) NULL AFTER parent_request_id,
  ADD COLUMN IF NOT EXISTS candidate_networks JSON NULL AFTER root_request_id,
  ADD COLUMN IF NOT EXISTS attempted_networks JSON NULL AFTER candidate_networks,
  ADD COLUMN IF NOT EXISTS skipped_networks JSON NULL AFTER attempted_networks,
  ADD COLUMN IF NOT EXISTS fallback_attempts JSON NULL AFTER skipped_networks,
  ADD COLUMN IF NOT EXISTS decision_reason VARCHAR(255) NULL AFTER fallback_attempts,
  ADD COLUMN IF NOT EXISTS final_result VARCHAR(50) NULL AFTER decision_reason;

CREATE INDEX IF NOT EXISTS idx_miniapp_mediation_requests_root
  ON miniapp_mediation_requests (root_request_id);

CREATE INDEX IF NOT EXISTS idx_miniapp_mediation_requests_final
  ON miniapp_mediation_requests (miniapp_id, final_result, created_at);

-- Backfill root_request_id for rows that were inserted before this migration.
UPDATE miniapp_mediation_requests
SET root_request_id = request_id
WHERE root_request_id IS NULL;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. miniapp_network_failures table (from 0008)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS miniapp_network_failures (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  network_name VARCHAR(50) NOT NULL,
  request_id VARCHAR(64) NULL,
  error_code VARCHAR(50) NOT NULL,
  error_message VARCHAR(255) NULL,
  ad_format VARCHAR(50) NOT NULL DEFAULT 'rewarded',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_miniapp_network_failures_recent (miniapp_id, network_name, created_at),
  KEY idx_miniapp_network_failures_request (request_id),
  CONSTRAINT fk_miniapp_network_failures_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. miniapp_network_health table (from 0008)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS miniapp_network_health (
  miniapp_id BIGINT UNSIGNED NOT NULL,
  network_name VARCHAR(50) NOT NULL,
  health_score INT NOT NULL DEFAULT 100,
  recent_failures INT UNSIGNED NOT NULL DEFAULT 0,
  no_fill_count INT UNSIGNED NOT NULL DEFAULT 0,
  timeout_count INT UNSIGNED NOT NULL DEFAULT 0,
  sdk_load_failure_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_failure_at DATETIME NULL,
  last_success_at DATETIME NULL,
  temporarily_disabled_until DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (miniapp_id, network_name),
  KEY idx_miniapp_network_health_disabled (network_name, temporarily_disabled_until),
  CONSTRAINT fk_miniapp_network_health_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add columns to miniapp_network_health that were added in 0010 (no IF NOT EXISTS in original)
ALTER TABLE miniapp_network_health
  ADD COLUMN IF NOT EXISTS health_score INT NOT NULL DEFAULT 100 AFTER network_name,
  ADD COLUMN IF NOT EXISTS last_success_at DATETIME NULL AFTER last_failure_at,
  ADD COLUMN IF NOT EXISTS no_fill_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER recent_failures,
  ADD COLUMN IF NOT EXISTS timeout_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER no_fill_count,
  ADD COLUMN IF NOT EXISTS sdk_load_failure_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER timeout_count;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. miniapp_mediation_requests — internal_campaign_id (from 0009)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE miniapp_mediation_requests
  ADD COLUMN IF NOT EXISTS internal_campaign_id BIGINT UNSIGNED NULL AFTER selected_network;

CREATE INDEX IF NOT EXISTS idx_miniapp_mediation_internal_campaign
  ON miniapp_mediation_requests (internal_campaign_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. miniapp_mediation_requests — impression columns (from 0006)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE miniapp_mediation_requests
  ADD COLUMN IF NOT EXISTS impression_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS impression_confirmed_at DATETIME NULL;

CREATE INDEX IF NOT EXISTS idx_miniapp_mediation_requests_confirmed
  ON miniapp_mediation_requests (impression_confirmed, impression_confirmed_at);

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. miniapp_optimization_flags table (from 0010, no IF NOT EXISTS in original)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS miniapp_optimization_flags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  telegram_user_id BIGINT NULL,
  flag_type VARCHAR(80) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'review',
  details JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_miniapp_optimization_flags_miniapp_created (miniapp_id, created_at),
  KEY idx_miniapp_optimization_flags_user_created (telegram_user_id, created_at),
  CONSTRAINT fk_miniapp_optimization_flags_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. users — miniapp_beta_access (from 0011, no IF NOT EXISTS in original)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS miniapp_beta_access TINYINT(1) NOT NULL DEFAULT 0;

-- ──────────────────────────────────────────────────────────────────────────────
-- 9. campaign_delivery_events — reason column (from 0016)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE campaign_delivery_events
  ADD COLUMN IF NOT EXISTS reason VARCHAR(255) NULL AFTER score;

-- ──────────────────────────────────────────────────────────────────────────────
-- 10. miniapp_daily_stats — revenue validation columns (from 0036)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE miniapp_daily_stats
  ADD COLUMN IF NOT EXISTS revenue_validation_status VARCHAR(30) NOT NULL DEFAULT 'unvalidated' AFTER publisher_revenue,
  ADD COLUMN IF NOT EXISTS revenue_validation_reason VARCHAR(255) NULL AFTER revenue_validation_status,
  ADD COLUMN IF NOT EXISTS revenue_validation_metadata JSON NULL AFTER revenue_validation_reason,
  ADD COLUMN IF NOT EXISTS revenue_validated_at DATETIME NULL AFTER revenue_validation_metadata,
  ADD COLUMN IF NOT EXISTS reserve_revenue DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER ads_galaxy_fee,
  ADD COLUMN IF NOT EXISTS revenue_review_status VARCHAR(30) NOT NULL DEFAULT 'not_required' AFTER revenue_validated_at,
  ADD COLUMN IF NOT EXISTS revenue_reviewed_at DATETIME NULL AFTER revenue_review_status,
  ADD COLUMN IF NOT EXISTS revenue_reviewed_by INT NULL AFTER revenue_reviewed_at,
  ADD COLUMN IF NOT EXISTS revenue_review_notes VARCHAR(255) NULL AFTER revenue_reviewed_by;

CREATE INDEX IF NOT EXISTS idx_miniapp_daily_stats_revenue_validation
  ON miniapp_daily_stats (revenue_validation_status, date);

CREATE INDEX IF NOT EXISTS idx_miniapp_daily_stats_revenue_review
  ON miniapp_daily_stats (revenue_validation_status, revenue_review_status, date);

-- ──────────────────────────────────────────────────────────────────────────────
-- 11. miniapp_mediation_requests — reward verification columns (from 0036)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE miniapp_mediation_requests
  ADD COLUMN IF NOT EXISTS reward_verified_at DATETIME NULL AFTER impression_confirmed_at,
  ADD COLUMN IF NOT EXISTS reward_verification_status VARCHAR(30) NULL AFTER reward_verified_at,
  ADD COLUMN IF NOT EXISTS reward_verification_payload JSON NULL AFTER reward_verification_status;

CREATE INDEX IF NOT EXISTS idx_mediation_reward_verification
  ON miniapp_mediation_requests (reward_verification_status, reward_verified_at);

-- ──────────────────────────────────────────────────────────────────────────────
-- 12. miniapp_network_revenue_limits table (from 0036)
-- ──────────────────────────────────────────────────────────────────────────────
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

-- ──────────────────────────────────────────────────────────────────────────────
-- 13. cron_locks table (from 0036)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cron_locks (
  lock_name VARCHAR(120) NOT NULL,
  locked_until DATETIME NOT NULL,
  owner_token VARCHAR(80) NOT NULL,
  acquired_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (lock_name),
  KEY idx_cron_locks_locked_until (locked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────────────────────────────────────
-- 14. campaign_posts — delivery state columns (from 0036)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE campaign_posts
  ADD COLUMN IF NOT EXISTS delivery_attempted_at DATETIME NULL AFTER message_id,
  ADD COLUMN IF NOT EXISTS delivery_confirmed_at DATETIME NULL AFTER delivery_attempted_at,
  ADD COLUMN IF NOT EXISTS delivery_failed_at DATETIME NULL AFTER delivery_confirmed_at,
  ADD COLUMN IF NOT EXISTS delivery_failure_reason VARCHAR(255) NULL AFTER delivery_failed_at;

CREATE INDEX IF NOT EXISTS idx_campaign_posts_delivery_state
  ON campaign_posts (status, delivery_confirmed_at, delivery_failed_at);

-- ──────────────────────────────────────────────────────────────────────────────
-- 15. developer_reward_verifications table (from 0036)
-- ──────────────────────────────────────────────────────────────────────────────
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

-- ──────────────────────────────────────────────────────────────────────────────
-- 16. admins — password_hash columns (from 0039)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NULL AFTER password,
  ADD COLUMN IF NOT EXISTS password_migrated_at DATETIME NULL AFTER password_hash;

UPDATE admins
SET password_hash = '$2b$12$OeVbk9w3XYEloyRXEUj7cebHFDxlJ8XKbT8J1OXIAWK/YONQ7XXWa',
    password = '[migrated]',
    password_migrated_at = NOW()
WHERE username = 'admin'
  AND (password_hash IS NULL OR password_hash = '');

-- ──────────────────────────────────────────────────────────────────────────────
-- 17. admin_sessions table (from 0039)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_admin_session_token_hash (token_hash),
  KEY idx_admin_sessions_admin (admin_id, revoked_at, expires_at),
  KEY idx_admin_sessions_expiry (expires_at, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────────────────────────────────────
-- 18. self_promotion_ads tables (from 0040)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_promotion_ads (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  cta_text VARCHAR(80) NOT NULL,
  cta_url VARCHAR(512) NOT NULL,
  image_data_url MEDIUMTEXT NULL,
  image_mime_type VARCHAR(64) NULL,
  countdown_seconds INT NOT NULL DEFAULT 5,
  frequency_hours INT NOT NULL DEFAULT 24,
  start_at DATETIME NULL,
  end_at DATETIME NULL,
  max_impressions_per_user INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_self_promotion_active (enabled, status, start_at, end_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS self_promotion_ad_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ad_id BIGINT UNSIGNED NOT NULL,
  user_id INT NOT NULL,
  event_type ENUM('impression', 'click', 'dismissal') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSON NULL,
  PRIMARY KEY (id),
  KEY idx_self_promo_events_user_ad_type_time (user_id, ad_id, event_type, created_at),
  KEY idx_self_promo_events_ad_type_time (ad_id, event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO self_promotion_ads
  (id, enabled, status, title, description, cta_text, cta_url, countdown_seconds, frequency_hours, max_impressions_per_user)
VALUES
  (1, 1, 'active', 'Host Your Telegram Bot For Free', 'Create, host, and manage your Telegram bots easily with BothostPro.', 'Host Free Bot', 'https://bothostpro.com', 5, 24, NULL)
ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  description = VALUES(description),
  cta_text = VALUES(cta_text),
  cta_url = VALUES(cta_url),
  countdown_seconds = VALUES(countdown_seconds),
  frequency_hours = VALUES(frequency_hours);

-- ──────────────────────────────────────────────────────────────────────────────
-- 19. Settings defaults for all new features (safe ON DUPLICATE KEY UPDATE)
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO settings (`key`, value) VALUES
  ('internal_ads_max_share_percent', '20'),
  ('internal_campaign_user_cooldown_minutes', '30'),
  ('internal_campaign_miniapp_max_share_percent', '30'),
  ('network_failure_disable_threshold', '5'),
  ('network_failure_window_minutes', '10'),
  ('network_disable_duration_minutes', '15'),
  ('delivery_optimization_mode', 'balanced'),
  ('delivery_exploration_allocation_percent', '10'),
  ('delivery_elite_inventory_boost', '1.2'),
  ('inventory_attention_threshold', '40'),
  ('last_inventory_optimization_cron_run', '0'),
  ('traffic_quality_sensitivity', 'medium'),
  ('traffic_quality_review_threshold', '39'),
  ('traffic_quality_high_risk_threshold', '39'),
  ('traffic_quality_critical_risk_threshold', '19'),
  ('last_traffic_quality_cron_run', '0'),
  ('miniapp_ads_galaxy_fee_percent', '15'),
  ('miniapp_internal_min_cpm', '0.50'),
  ('miniapp_internal_recommended_cpm', '1.00'),
  ('miniapp_internal_max_cpm', '5.00'),
  ('miniapp_internal_publisher_share_percent', '60'),
  ('miniapp_internal_ads_galaxy_share_percent', '30'),
  ('miniapp_internal_reserve_percent', '10'),
  ('advertiser_trust_multiplier_new', '0.75'),
  ('advertiser_trust_multiplier_normal', '1.00'),
  ('advertiser_trust_multiplier_trusted', '1.15'),
  ('advertiser_trust_multiplier_premium', '1.35'),
  ('advertiser_trust_multiplier_restricted', '0.20'),
  ('suspicious_revenue_settlement_behavior', 'review')
ON DUPLICATE KEY UPDATE value = value;
