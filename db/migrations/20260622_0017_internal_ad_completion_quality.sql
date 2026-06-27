-- Phase 7A: internal rewarded ad completion quality.
-- Additive only. Impression counting, advertiser billing, settlement formulas, and network integrations remain unchanged.

ALTER TABLE miniapp_internal_ad_impressions
  ADD COLUMN IF NOT EXISTS watch_duration_seconds DECIMAL(10,3) NOT NULL DEFAULT 0 AFTER cpm_mode,
  ADD COLUMN IF NOT EXISTS completion_status VARCHAR(30) NOT NULL DEFAULT 'impression_recorded' AFTER watch_duration_seconds,
  ADD COLUMN IF NOT EXISTS completion_quality_tier VARCHAR(40) NOT NULL DEFAULT 'fraud_watch' AFTER completion_status,
  ADD COLUMN IF NOT EXISTS completion_quality_score INT NOT NULL DEFAULT 0 AFTER completion_quality_tier,
  ADD COLUMN IF NOT EXISTS completed_at DATETIME NULL AFTER completion_quality_score,
  ADD COLUMN IF NOT EXISTS abandoned_at DATETIME NULL AFTER completed_at,
  ADD COLUMN IF NOT EXISTS abandonment_reason VARCHAR(50) NULL AFTER abandoned_at,
  ADD COLUMN IF NOT EXISTS fraud_escalation_level VARCHAR(30) NOT NULL DEFAULT 'ignore' AFTER abandonment_reason,
  ADD COLUMN IF NOT EXISTS fraud_signal_count INT NOT NULL DEFAULT 0 AFTER fraud_escalation_level;

CREATE TABLE IF NOT EXISTS miniapp_internal_ad_completion_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(100) NOT NULL,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  campaign_id BIGINT UNSIGNED NULL,
  telegram_user_id VARCHAR(100) NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  watch_duration_seconds DECIMAL(10,3) NOT NULL DEFAULT 0,
  quality_tier VARCHAR(40) NOT NULL,
  fraud_escalation_level VARCHAR(30) NOT NULL DEFAULT 'ignore',
  abandonment_reason VARCHAR(50) NULL,
  metadata JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_completion_request (request_id),
  INDEX idx_completion_miniapp_time (miniapp_id, created_at),
  INDEX idx_completion_user_window (miniapp_id, telegram_user_id, created_at),
  INDEX idx_completion_event_type (event_type, created_at)
);
