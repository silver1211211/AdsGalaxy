-- Additive Prompt 12 schema. Do not execute from application request paths.
CREATE TABLE IF NOT EXISTS campaign_create_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  advertiser_id INT NOT NULL,
  operation_name VARCHAR(24) NOT NULL,
  idempotency_key CHAR(64) NOT NULL,
  request_fingerprint CHAR(64) NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'processing',
  campaign_id BIGINT UNSIGNED NULL,
  response_json JSON NULL,
  last_error VARCHAR(64) NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_campaign_create_request (advertiser_id,operation_name,idempotency_key),
  KEY idx_campaign_create_campaign (operation_name,campaign_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_referral_ip VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS last_referral_user_agent_hash CHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS last_referral_device_hash CHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS last_referral_seen_at DATETIME NULL;

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS join_ip VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS join_user_agent_hash CHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS join_device_hash CHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS self_referral_blocked TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verification_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reward_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reward_amount DECIMAL(18,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS required_channel VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS verified_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS reward_paid_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS abuse_risk_level VARCHAR(20) NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS abuse_flags JSON NULL,
  ADD COLUMN IF NOT EXISTS sprint_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

SET @idx_exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='referrals' AND index_name='idx_referrals_security_signals');
SET @sql := IF(@idx_exists=0,
  'CREATE INDEX idx_referrals_security_signals ON referrals(join_device_hash,join_ip,join_user_agent_hash)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
