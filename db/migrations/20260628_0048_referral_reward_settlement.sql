-- Referral reward settlement replacement.
-- Referral rewards are queued as pending first, then released or marked fraud by settlement.

ALTER TABLE referral_reward_ledger
  ADD COLUMN IF NOT EXISTS settlement_run_id BIGINT UNSIGNED NULL AFTER status,
  ADD COLUMN IF NOT EXISTS settled_at DATETIME NULL AFTER settlement_run_id;

CREATE TABLE IF NOT EXISTS referral_settlement_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  settlement_date DATE NOT NULL,
  settlement_type VARCHAR(40) NOT NULL DEFAULT 'daily_referral',
  status VARCHAR(30) NOT NULL DEFAULT 'running',
  verified_referrals INT NOT NULL DEFAULT 0,
  channel_conversions INT NOT NULL DEFAULT 0,
  conversion_percent DECIMAL(8,4) NOT NULL DEFAULT 0,
  total_pending DECIMAL(18,8) NOT NULL DEFAULT 0,
  total_paid DECIMAL(18,8) NOT NULL DEFAULT 0,
  total_fraud DECIMAL(18,8) NOT NULL DEFAULT 0,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  metadata JSON NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_referral_settlement_run (settlement_date, settlement_type),
  KEY idx_referral_settlement_runs_status (status, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referral_settlement_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  settlement_run_id BIGINT UNSIGNED NOT NULL,
  user_id INT NOT NULL,
  team_id BIGINT UNSIGNED NULL,
  settlement_date DATE NOT NULL,
  reward_label VARCHAR(120) NOT NULL,
  reward_type VARCHAR(60) NOT NULL,
  amount DECIMAL(18,8) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL,
  reason VARCHAR(255) NULL,
  verified_referrals INT NOT NULL DEFAULT 0,
  channel_conversions INT NOT NULL DEFAULT 0,
  conversion_percent DECIMAL(8,4) NOT NULL DEFAULT 0,
  metadata JSON NULL,
  notified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_referral_settlement_history (user_id, settlement_date, reward_type, team_id),
  KEY idx_referral_settlement_history_user (user_id, created_at),
  KEY idx_referral_settlement_history_run (settlement_run_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO referral_growth_settings (`key`, value, description) VALUES
  ('referral_settlement_time', '00:00', 'Daily referral reward settlement time in HH:mm server time'),
  ('referral_fraud_min_channel_conversion_percent', '3', 'Minimum percent of verified referrals who added channels before pending rewards are released'),
  ('team_sprint_referral_target', '5000', 'Verified referral target required for team sprint reward pool settlement'),
  ('team_sprint_reward_pool', '100', 'Team sprint reward pool distributed proportionally by verified referral contribution')
ON DUPLICATE KEY UPDATE description = VALUES(description);
