-- Phase 12: self-service automation, auto approval, smart moderation, queues, policies, warnings, suspensions.
-- Additive only. Does not change payout calculations, CPM calculations, fraud engine,
-- conversion tracking, inventory ranking, or network integrations.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS automation_decision VARCHAR(30) NULL AFTER status,
  ADD COLUMN IF NOT EXISTS automation_rule_used VARCHAR(120) NULL AFTER automation_decision,
  ADD COLUMN IF NOT EXISTS automation_review_reason VARCHAR(255) NULL AFTER automation_rule_used,
  ADD COLUMN IF NOT EXISTS automation_checked_at DATETIME NULL AFTER automation_review_reason;

ALTER TABLE miniapp_rewarded_campaigns
  ADD COLUMN IF NOT EXISTS automation_decision VARCHAR(30) NULL AFTER status,
  ADD COLUMN IF NOT EXISTS automation_rule_used VARCHAR(120) NULL AFTER automation_decision,
  ADD COLUMN IF NOT EXISTS automation_review_reason VARCHAR(255) NULL AFTER automation_rule_used,
  ADD COLUMN IF NOT EXISTS automation_checked_at DATETIME NULL AFTER automation_review_reason;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS automation_warning_level VARCHAR(30) NOT NULL DEFAULT 'none' AFTER advertiser_trust_level,
  ADD COLUMN IF NOT EXISTS automation_suspension_status VARCHAR(30) NOT NULL DEFAULT 'active' AFTER automation_warning_level,
  ADD COLUMN IF NOT EXISTS automation_suspended_until DATETIME NULL AFTER automation_suspension_status;

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS automation_suspension_status VARCHAR(30) NOT NULL DEFAULT 'active' AFTER marketplace_avg_completion_rate,
  ADD COLUMN IF NOT EXISTS automation_suspended_until DATETIME NULL AFTER automation_suspension_status;

ALTER TABLE bots
  ADD COLUMN IF NOT EXISTS automation_suspension_status VARCHAR(30) NOT NULL DEFAULT 'active' AFTER marketplace_avg_completion_rate,
  ADD COLUMN IF NOT EXISTS automation_suspended_until DATETIME NULL AFTER automation_suspension_status;

ALTER TABLE miniapps
  ADD COLUMN IF NOT EXISTS automation_suspension_status VARCHAR(30) NOT NULL DEFAULT 'active' AFTER marketplace_avg_completion_rate,
  ADD COLUMN IF NOT EXISTS automation_suspended_until DATETIME NULL AFTER automation_suspension_status;

CREATE TABLE IF NOT EXISTS automation_settings (
  `key` VARCHAR(120) NOT NULL PRIMARY KEY,
  value TEXT NOT NULL,
  description VARCHAR(255) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_category_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  category VARCHAR(120) NOT NULL,
  decision VARCHAR(30) NOT NULL DEFAULT 'review',
  applies_to VARCHAR(30) NOT NULL DEFAULT 'all',
  reason VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_automation_category_rule (category, applies_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS domain_trust_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  domain VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'normal',
  approval_count INT NOT NULL DEFAULT 0,
  campaign_count INT NOT NULL DEFAULT 0,
  conversion_count INT NOT NULL DEFAULT 0,
  violation_count INT NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_domain_trust_domain (domain),
  KEY idx_domain_trust_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_policies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  policy_key VARCHAR(120) NOT NULL,
  title VARCHAR(180) NOT NULL,
  body TEXT NOT NULL,
  severity VARCHAR(30) NOT NULL DEFAULT 'medium',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_platform_policy_key (policy_key),
  KEY idx_platform_policies_active (active, severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS campaign_review_queue (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_type VARCHAR(30) NOT NULL,
  campaign_id BIGINT UNSIGNED NOT NULL,
  advertiser_id INT NOT NULL,
  risk_level VARCHAR(30) NOT NULL DEFAULT 'medium',
  reason VARCHAR(255) NOT NULL,
  rule_used VARCHAR(120) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  reviewed_by INT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_campaign_review_open (campaign_type, campaign_id, status),
  KEY idx_campaign_review_status (status, risk_level, created_at),
  KEY idx_campaign_review_advertiser (advertiser_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS domain_review_queue (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  domain VARCHAR(255) NOT NULL,
  risk_level VARCHAR(30) NOT NULL DEFAULT 'medium',
  reason VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  reviewed_by INT NULL,
  PRIMARY KEY (id),
  KEY idx_domain_review_status (status, risk_level, created_at),
  KEY idx_domain_review_domain (domain, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS publisher_review_queue (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  publisher_id INT NOT NULL,
  inventory_type VARCHAR(30) NULL,
  inventory_id BIGINT UNSIGNED NULL,
  risk_level VARCHAR(30) NOT NULL DEFAULT 'medium',
  reason VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  reviewed_by INT NULL,
  PRIMARY KEY (id),
  KEY idx_publisher_review_status (status, risk_level, created_at),
  KEY idx_publisher_review_publisher (publisher_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_type VARCHAR(30) NOT NULL,
  actor_id INT NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  decision VARCHAR(30) NULL,
  rule_used VARCHAR(120) NULL,
  reason VARCHAR(255) NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_automation_audit_entity (entity_type, entity_id, created_at),
  KEY idx_automation_audit_actor (actor_type, actor_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_moderation_warnings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  warning_level VARCHAR(30) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  issued_by VARCHAR(30) NOT NULL DEFAULT 'automation',
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_warnings_user (user_id, created_at),
  KEY idx_user_warnings_level (warning_level, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automation_suspensions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type VARCHAR(40) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  scope VARCHAR(40) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  reason VARCHAR(255) NOT NULL,
  suspended_until DATETIME NULL,
  created_by VARCHAR(30) NOT NULL DEFAULT 'admin',
  created_by_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  restored_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_automation_suspensions_entity (entity_type, entity_id, status),
  KEY idx_automation_suspensions_status (status, suspended_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO automation_settings (`key`, value, description) VALUES
  ('approval_mode', 'hybrid', 'manual, hybrid, or automatic'),
  ('trusted_auto_approve', 'true', 'Trusted advertisers may auto approve in hybrid mode'),
  ('premium_auto_approve', 'true', 'Premium advertisers may auto approve in hybrid mode'),
  ('restricted_always_review', 'true', 'Restricted advertisers always enter review'),
  ('min_quality_score_auto_approve', '75', 'Minimum creative quality score for auto approval'),
  ('max_previous_rejections_auto_approve', '0', 'Maximum previous rejected campaigns for auto approval'),
  ('duplicate_creative_review_threshold', '2', 'Repeated creative reuse threshold'),
  ('duplicate_landing_review_threshold', '2', 'Repeated landing page reuse threshold')
ON DUPLICATE KEY UPDATE value = value;

INSERT INTO automation_category_rules (category, decision, applies_to, reason) VALUES
  ('Utilities', 'auto_approve', 'all', 'Low-risk utility category'),
  ('Education', 'auto_approve', 'all', 'Low-risk education category'),
  ('Gaming', 'auto_approve', 'all', 'Approved gaming category'),
  ('Finance', 'review', 'all', 'Financial claims require review'),
  ('Crypto', 'review', 'all', 'Crypto campaigns require review'),
  ('Trading', 'review', 'all', 'Trading campaigns require review')
ON DUPLICATE KEY UPDATE decision = VALUES(decision), reason = VALUES(reason);

INSERT INTO platform_policies (policy_key, title, body, severity) VALUES
  ('duplicate_spam', 'Duplicate spam policy', 'Repeated identical creatives or landing pages may require manual review.', 'medium'),
  ('restricted_finance_claims', 'Financial and trading claims', 'Finance, crypto, and trading campaigns require additional review unless explicitly trusted.', 'high'),
  ('blocked_domain', 'Blocked domains', 'Campaigns using blocked domains must be rejected or changed before approval.', 'critical')
ON DUPLICATE KEY UPDATE title = VALUES(title), body = VALUES(body), severity = VALUES(severity);
