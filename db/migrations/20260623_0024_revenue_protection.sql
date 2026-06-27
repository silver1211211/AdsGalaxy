-- Phase 12A: revenue protection, payout protection, spending protection, reserve controls, and emergency safeguards.
-- Additive safety layer. Does not modify campaign creation, conversion tracking, referral sprint, marketplace, or network integrations.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS revenue_protection_status VARCHAR(30) NOT NULL DEFAULT 'normal' AFTER automation_checked_at,
  ADD COLUMN IF NOT EXISTS revenue_protection_reason VARCHAR(255) NULL AFTER revenue_protection_status,
  ADD COLUMN IF NOT EXISTS revenue_protection_paused_at DATETIME NULL AFTER revenue_protection_reason;

ALTER TABLE miniapp_rewarded_campaigns
  ADD COLUMN IF NOT EXISTS revenue_protection_status VARCHAR(30) NOT NULL DEFAULT 'normal' AFTER automation_checked_at,
  ADD COLUMN IF NOT EXISTS revenue_protection_reason VARCHAR(255) NULL AFTER revenue_protection_status,
  ADD COLUMN IF NOT EXISTS revenue_protection_paused_at DATETIME NULL AFTER revenue_protection_reason;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS advertiser_risk_score INT NOT NULL DEFAULT 0 AFTER automation_suspended_until,
  ADD COLUMN IF NOT EXISTS publisher_risk_score INT NOT NULL DEFAULT 0 AFTER advertiser_risk_score,
  ADD COLUMN IF NOT EXISTS revenue_protection_status VARCHAR(30) NOT NULL DEFAULT 'normal' AFTER publisher_risk_score;

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS revenue_protection_status VARCHAR(30) NOT NULL DEFAULT 'normal' AFTER automation_suspended_until;

ALTER TABLE bots
  ADD COLUMN IF NOT EXISTS revenue_protection_status VARCHAR(30) NOT NULL DEFAULT 'normal' AFTER automation_suspended_until;

ALTER TABLE miniapps
  ADD COLUMN IF NOT EXISTS revenue_protection_status VARCHAR(30) NOT NULL DEFAULT 'normal' AFTER automation_suspended_until;

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS revenue_protection_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(100) NOT NULL,
  value VARCHAR(255) NOT NULL,
  description VARCHAR(255) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_revenue_protection_setting (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS revenue_protection_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  rule_key VARCHAR(100) NOT NULL,
  rule_type VARCHAR(40) NOT NULL,
  threshold_value DECIMAL(18,8) NOT NULL DEFAULT 0,
  severity VARCHAR(20) NOT NULL DEFAULT 'medium',
  action VARCHAR(40) NOT NULL DEFAULT 'alert',
  active TINYINT(1) NOT NULL DEFAULT 1,
  description VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_revenue_protection_rule (rule_key),
  KEY idx_revenue_protection_rules_active (active, rule_type, severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS revenue_protection_alerts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type VARCHAR(40) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  metric_key VARCHAR(100) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'medium',
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  title VARCHAR(180) NOT NULL,
  details TEXT NULL,
  current_value DECIMAL(18,8) NOT NULL DEFAULT 0,
  threshold_value DECIMAL(18,8) NOT NULL DEFAULT 0,
  rule_key VARCHAR(100) NULL,
  action_taken VARCHAR(40) NULL,
  metadata JSON NULL,
  ignored_at DATETIME NULL,
  marked_safe_at DATETIME NULL,
  resolved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_revenue_alerts_status_severity (status, severity, created_at),
  KEY idx_revenue_alerts_entity (entity_type, entity_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS revenue_protection_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_type VARCHAR(30) NOT NULL DEFAULT 'system',
  actor_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  rule_triggered VARCHAR(100) NULL,
  reason VARCHAR(255) NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_revenue_audit_entity (entity_type, entity_id, created_at),
  KEY idx_revenue_audit_action (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS revenue_protection_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  period_type VARCHAR(20) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  campaign_spend DECIMAL(18,8) NOT NULL DEFAULT 0,
  advertiser_spend DECIMAL(18,8) NOT NULL DEFAULT 0,
  publisher_earnings DECIMAL(18,8) NOT NULL DEFAULT 0,
  platform_revenue DECIMAL(18,8) NOT NULL DEFAULT 0,
  reserve_revenue DECIMAL(18,8) NOT NULL DEFAULT 0,
  net_profit DECIMAL(18,8) NOT NULL DEFAULT 0,
  profit_margin DECIMAL(10,6) NOT NULL DEFAULT 0,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_revenue_snapshot_period (period_type, period_start, period_end),
  KEY idx_revenue_snapshots_period (period_type, period_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payout_safety_checks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  settlement_type VARCHAR(40) NOT NULL,
  settlement_id BIGINT UNSIGNED NULL,
  campaign_id BIGINT UNSIGNED NULL,
  publisher_id BIGINT UNSIGNED NULL,
  advertiser_paid DECIMAL(18,8) NOT NULL DEFAULT 0,
  publisher_share DECIMAL(18,8) NOT NULL DEFAULT 0,
  platform_share DECIMAL(18,8) NOT NULL DEFAULT 0,
  reserve_share DECIMAL(18,8) NOT NULL DEFAULT 0,
  expected_publisher_share DECIMAL(18,8) NOT NULL DEFAULT 0,
  expected_platform_share DECIMAL(18,8) NOT NULL DEFAULT 0,
  expected_reserve_share DECIMAL(18,8) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'passed',
  reason VARCHAR(255) NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payout_safety_status (status, created_at),
  KEY idx_payout_safety_campaign (campaign_id, publisher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS financial_safety_overrides (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type VARCHAR(40) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  override_type VARCHAR(40) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  expires_at DATETIME NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_financial_overrides_entity (entity_type, entity_id, override_type, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO revenue_protection_settings (`key`, value, description) VALUES
  ('revenue_protection_enabled', '1', 'Enable revenue protection scanning and alerts'),
  ('emergency_protection_mode', '0', 'When enabled, critical rules may pause campaigns, publishers, inventory, and traffic sources'),
  ('reserve_pool_percent', '10', 'Reserve pool percent that must remain protected from publisher payout'),
  ('daily_budget_fast_burn_percent', '50', 'Alert when this percent of daily budget is consumed quickly'),
  ('campaign_budget_alert_percent', '80', 'Alert when this percent of campaign budget is consumed'),
  ('campaign_budget_critical_percent', '100', 'Critical threshold for full budget consumption'),
  ('hourly_spend_spike_multiplier', '3', 'Alert when hourly spend exceeds recent average by this multiplier'),
  ('traffic_spike_multiplier', '3', 'Alert when impressions, clicks, conversions, referrals, or revenue spike above recent average'),
  ('publisher_critical_risk_score', '80', 'Publisher risk score that triggers critical protection'),
  ('advertiser_critical_risk_score', '80', 'Advertiser risk score that triggers critical protection'),
  ('negative_profitability_auto_pause', '1', 'Auto pause when protected emergency mode sees negative profitability'),
  ('reserve_depletion_auto_pause', '1', 'Auto pause when reserve requirements are not met')
ON DUPLICATE KEY UPDATE value = value;

INSERT INTO revenue_protection_rules (rule_key, rule_type, threshold_value, severity, action, description) VALUES
  ('budget_50_fast_burn', 'spend', 50, 'medium', 'alert', '50% daily budget consumed quickly'),
  ('budget_80_consumed', 'spend', 80, 'high', 'alert', '80% campaign budget consumed'),
  ('budget_100_consumed', 'spend', 100, 'critical', 'pause', '100% campaign budget consumed'),
  ('critical_publisher_risk', 'risk', 80, 'critical', 'pause', 'Publisher risk score is critical'),
  ('critical_advertiser_risk', 'risk', 80, 'critical', 'pause', 'Advertiser risk score is critical'),
  ('negative_profitability', 'profitability', 0, 'critical', 'pause', 'Campaign or inventory profitability is negative'),
  ('reserve_mismatch', 'reserve', 0, 'critical', 'alert', 'Publisher, platform, and reserve shares do not match configured protection rules'),
  ('traffic_anomaly', 'traffic', 3, 'high', 'alert', 'Traffic or revenue spike exceeded configured multiplier')
ON DUPLICATE KEY UPDATE threshold_value = VALUES(threshold_value), severity = VALUES(severity), action = VALUES(action);
