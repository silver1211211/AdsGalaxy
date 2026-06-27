-- Phase 12B: referral growth, sprint competitions, leaderboards, and referral reward management.
-- Additive growth layer. Does not modify payout engine, CPM engine, conversion tracking,
-- fraud engine, marketplace, or network integrations.

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'pending' AFTER invited_by,
  ADD COLUMN IF NOT EXISTS verification_status VARCHAR(30) NOT NULL DEFAULT 'pending' AFTER status,
  ADD COLUMN IF NOT EXISTS reward_status VARCHAR(30) NOT NULL DEFAULT 'pending' AFTER verification_status,
  ADD COLUMN IF NOT EXISTS reward_amount DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER reward_status,
  ADD COLUMN IF NOT EXISTS required_channel VARCHAR(255) NULL AFTER reward_amount,
  ADD COLUMN IF NOT EXISTS verified_at DATETIME NULL AFTER required_channel,
  ADD COLUMN IF NOT EXISTS reward_paid_at DATETIME NULL AFTER verified_at,
  ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(255) NULL AFTER reward_paid_at,
  ADD COLUMN IF NOT EXISTS abuse_risk_level VARCHAR(20) NOT NULL DEFAULT 'low' AFTER rejection_reason,
  ADD COLUMN IF NOT EXISTS abuse_flags JSON NULL AFTER abuse_risk_level,
  ADD COLUMN IF NOT EXISTS sprint_id BIGINT UNSIGNED NULL AFTER abuse_flags,
  ADD COLUMN IF NOT EXISTS created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS referral_growth_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(100) NOT NULL,
  value VARCHAR(255) NOT NULL,
  description VARCHAR(255) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_referral_growth_setting (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referral_sprints (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  duration_days INT NOT NULL DEFAULT 14,
  first_place_reward DECIMAL(18,8) NOT NULL DEFAULT 10,
  second_place_reward DECIMAL(18,8) NOT NULL DEFAULT 5,
  third_place_reward DECIMAL(18,8) NOT NULL DEFAULT 2,
  auto_restart TINYINT(1) NOT NULL DEFAULT 1,
  archived_at DATETIME NULL,
  rewards_paid_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_referral_sprints_status_dates (status, starts_at, ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referral_sprint_winners (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sprint_id BIGINT UNSIGNED NOT NULL,
  user_id INT NOT NULL,
  rank_position INT NOT NULL,
  referral_count INT NOT NULL DEFAULT 0,
  reward_amount DECIMAL(18,8) NOT NULL DEFAULT 0,
  reward_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  paid_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_sprint_rank (sprint_id, rank_position),
  UNIQUE KEY uniq_sprint_user (sprint_id, user_id),
  KEY idx_sprint_winners_user (user_id, paid_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referral_reward_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  referral_id INT NULL,
  sprint_id BIGINT UNSIGNED NULL,
  reward_type VARCHAR(40) NOT NULL,
  amount DECIMAL(18,8) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'paid',
  reason VARCHAR(255) NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_referral_reward_once (reward_type, referral_id),
  KEY idx_referral_reward_user (user_id, reward_type, created_at),
  KEY idx_referral_reward_sprint (sprint_id, reward_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referral_abuse_flags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  referral_id INT NULL,
  referrer_id INT NULL,
  referred_user_id INT NULL,
  signal_key VARCHAR(80) NOT NULL,
  risk_level VARCHAR(20) NOT NULL DEFAULT 'medium',
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  reason VARCHAR(255) NOT NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  reviewed_by INT NULL,
  PRIMARY KEY (id),
  KEY idx_referral_abuse_status (status, risk_level, created_at),
  KEY idx_referral_abuse_referrer (referrer_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referral_sprint_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_type VARCHAR(30) NOT NULL DEFAULT 'system',
  actor_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  reason VARCHAR(255) NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_referral_audit_entity (entity_type, entity_id, created_at),
  KEY idx_referral_audit_action (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO referral_growth_settings (`key`, value, description) VALUES
  ('referral_reward_amount', '0.015', 'Reward paid to the referrer after the referred user verifies required channel membership'),
  ('required_channel_url', 'https://t.me/AdsGalaxy_News', 'Required channel users must join before referral reward is paid'),
  ('required_channel_username', 'AdsGalaxy_News', 'Telegram username used for membership verification'),
  ('sprint_duration_days', '14', 'Default referral sprint duration'),
  ('sprint_first_place_reward', '10', 'First place sprint bonus'),
  ('sprint_second_place_reward', '5', 'Second place sprint bonus'),
  ('sprint_third_place_reward', '2', 'Third place sprint bonus'),
  ('sprint_auto_restart', '1', 'Automatically archive finished sprint and create the next one'),
  ('referral_mass_creation_threshold_daily', '25', 'Daily referral creation threshold for abuse flagging'),
  ('referral_loop_detection_enabled', '1', 'Flag suspicious reciprocal referral patterns')
ON DUPLICATE KEY UPDATE value = value;

INSERT INTO referral_sprints
  (name, status, starts_at, ends_at, duration_days, first_place_reward, second_place_reward, third_place_reward, auto_restart)
SELECT 'Referral Sprint', 'active', NOW(), DATE_ADD(NOW(), INTERVAL 14 DAY), 14, 10, 5, 2, 1
WHERE NOT EXISTS (SELECT 1 FROM referral_sprints WHERE status = 'active');
