-- Phase 7: fraud detection, traffic integrity, and admin traffic intelligence.
-- Additive only. Does not modify payouts, settlements, withdrawals, billing, or network onboarding.

ALTER TABLE miniapps
  ADD COLUMN IF NOT EXISTS traffic_quality_score INT NOT NULL DEFAULT 60 AFTER status,
  ADD COLUMN IF NOT EXISTS traffic_quality_tier VARCHAR(20) NOT NULL DEFAULT 'good' AFTER traffic_quality_score,
  ADD COLUMN IF NOT EXISTS traffic_risk_level VARCHAR(20) NOT NULL DEFAULT 'low' AFTER traffic_quality_tier,
  ADD COLUMN IF NOT EXISTS traffic_quality_updated_at DATETIME NULL AFTER traffic_risk_level;

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS traffic_quality_score INT NOT NULL DEFAULT 60 AFTER status,
  ADD COLUMN IF NOT EXISTS traffic_quality_tier VARCHAR(20) NOT NULL DEFAULT 'good' AFTER traffic_quality_score,
  ADD COLUMN IF NOT EXISTS traffic_risk_level VARCHAR(20) NOT NULL DEFAULT 'low' AFTER traffic_quality_tier,
  ADD COLUMN IF NOT EXISTS traffic_quality_updated_at DATETIME NULL AFTER traffic_risk_level;

ALTER TABLE bots
  ADD COLUMN IF NOT EXISTS traffic_quality_score INT NOT NULL DEFAULT 60 AFTER status,
  ADD COLUMN IF NOT EXISTS traffic_quality_tier VARCHAR(20) NOT NULL DEFAULT 'good' AFTER traffic_quality_score,
  ADD COLUMN IF NOT EXISTS traffic_risk_level VARCHAR(20) NOT NULL DEFAULT 'low' AFTER traffic_quality_tier,
  ADD COLUMN IF NOT EXISTS traffic_quality_updated_at DATETIME NULL AFTER traffic_risk_level;

CREATE TABLE IF NOT EXISTS traffic_quality_daily_scores (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type VARCHAR(20) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  date DATE NOT NULL,
  quality_score INT NOT NULL DEFAULT 60,
  quality_tier VARCHAR(20) NOT NULL DEFAULT 'good',
  risk_level VARCHAR(20) NOT NULL DEFAULT 'low',
  impressions BIGINT NOT NULL DEFAULT 0,
  unique_users BIGINT NOT NULL DEFAULT 0,
  repeat_user_ratio DECIMAL(10,6) NOT NULL DEFAULT 0,
  repeat_impression_ratio DECIMAL(10,6) NOT NULL DEFAULT 0,
  top_user_impression_ratio DECIMAL(10,6) NOT NULL DEFAULT 0,
  velocity_score INT NOT NULL DEFAULT 100,
  country_breakdown JSON NULL,
  device_breakdown JSON NULL,
  language_breakdown JSON NULL,
  session_breakdown JSON NULL,
  signal_metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_traffic_quality_daily (entity_type, entity_id, date),
  KEY idx_traffic_quality_daily_score (quality_score, risk_level),
  KEY idx_traffic_quality_daily_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS traffic_review_queue (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type VARCHAR(20) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  risk_level VARCHAR(20) NOT NULL,
  quality_score INT NOT NULL,
  reason VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  reviewed_by INT NULL,
  PRIMARY KEY (id),
  KEY idx_traffic_review_status_risk (status, risk_level, created_at),
  KEY idx_traffic_review_entity (entity_type, entity_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO settings (`key`, value) VALUES
  ('traffic_quality_sensitivity', 'medium'),
  ('traffic_quality_review_threshold', '39'),
  ('traffic_quality_high_risk_threshold', '39'),
  ('traffic_quality_critical_risk_threshold', '19'),
  ('last_traffic_quality_cron_run', '0')
ON DUPLICATE KEY UPDATE value = value;
