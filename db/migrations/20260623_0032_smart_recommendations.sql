-- Phase 14: AI-ready smart recommendations, alerts, and automation mode.
-- Additive only. Does not modify payout, withdrawal, referral sprint, scheduler, broadcast,
-- public SDK, CPM engines, or network integrations.

CREATE TABLE IF NOT EXISTS smart_recommendations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  stable_key VARCHAR(180) NOT NULL,
  audience_type VARCHAR(30) NOT NULL,
  owner_user_id INT NULL,
  entity_type VARCHAR(40) NULL,
  entity_id BIGINT UNSIGNED NULL,
  recommendation_type VARCHAR(60) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'info',
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  feedback VARCHAR(20) NULL,
  title VARCHAR(180) NOT NULL,
  summary TEXT NOT NULL,
  action_label VARCHAR(120) NULL,
  masked_subject VARCHAR(120) NULL,
  score_explanation TEXT NULL,
  suggestions JSON NULL,
  metrics JSON NULL,
  automation_eligible TINYINT(1) NOT NULL DEFAULT 0,
  source VARCHAR(40) NOT NULL DEFAULT 'rule_based',
  applied_at DATETIME NULL,
  ignored_at DATETIME NULL,
  resolved_at DATETIME NULL,
  feedback_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_smart_recommendation_stable (stable_key),
  KEY idx_smart_recommendations_audience (audience_type, owner_user_id, status, severity),
  KEY idx_smart_recommendations_entity (entity_type, entity_id, status),
  KEY idx_smart_recommendations_type (recommendation_type, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO settings (`key`, value) VALUES
  ('smart_automation_mode', 'recommend_only'),
  ('smart_recommendations_enabled', '1'),
  ('smart_alerts_enabled', '1'),
  ('smart_low_risk_auto_apply_enabled', '0'),
  ('smart_ai_provider', 'rule_based')
ON DUPLICATE KEY UPDATE value = value;
