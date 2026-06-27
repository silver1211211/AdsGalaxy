-- Phase 12B+: referral milestones, team league, growth events, and masked user surfaces.
-- Additive only. Does not modify CPM, payout, withdrawal, fraud core, or network integrations.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referral_code VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS total_referral_earnings DECIMAL(18,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_referral_bonus_paid TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE referral_sprints
  ADD COLUMN IF NOT EXISTS best_team_reward DECIMAL(18,8) NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS second_team_reward DECIMAL(18,8) NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS third_team_reward DECIMAL(18,8) NOT NULL DEFAULT 4;

CREATE TABLE IF NOT EXISTS referral_team_name_pool (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(80) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'available',
  reserved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_referral_team_name (name),
  KEY idx_referral_team_name_status (status, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referral_teams (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(80) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  capacity INT NOT NULL DEFAULT 50,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_referral_team_name_active (name),
  KEY idx_referral_teams_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referral_team_memberships (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  team_id BIGINT UNSIGNED NOT NULL,
  user_id INT NOT NULL,
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_referral_team_user (user_id),
  KEY idx_referral_team_members_team (team_id, joined_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referral_milestones (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scope VARCHAR(20) NOT NULL DEFAULT 'user',
  threshold_count INT NOT NULL,
  reward_type VARCHAR(40) NOT NULL DEFAULT 'withdrawable_balance',
  reward_amount DECIMAL(18,8) NOT NULL DEFAULT 0,
  reward_label VARCHAR(160) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_referral_milestone (scope, threshold_count, reward_type, reward_amount),
  KEY idx_referral_milestones_scope (scope, status, threshold_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referral_milestone_claims (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  milestone_id BIGINT UNSIGNED NOT NULL,
  user_id INT NULL,
  team_id BIGINT UNSIGNED NULL,
  sprint_id BIGINT UNSIGNED NULL,
  amount DECIMAL(18,8) NOT NULL DEFAULT 0,
  reward_type VARCHAR(40) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'paid',
  paid_at DATETIME NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_referral_milestone_user_claim (milestone_id, user_id),
  UNIQUE KEY uniq_referral_milestone_team_claim (milestone_id, team_id),
  KEY idx_referral_milestone_claims_sprint (sprint_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referral_team_rewards (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sprint_id BIGINT UNSIGNED NOT NULL,
  team_id BIGINT UNSIGNED NOT NULL,
  rank_position INT NOT NULL,
  referral_count INT NOT NULL DEFAULT 0,
  reward_amount DECIMAL(18,8) NOT NULL DEFAULT 0,
  reward_status VARCHAR(30) NOT NULL DEFAULT 'paid',
  paid_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_referral_team_reward_rank (sprint_id, rank_position),
  UNIQUE KEY uniq_referral_team_reward_team (sprint_id, team_id),
  KEY idx_referral_team_rewards_team (team_id, paid_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referral_growth_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  event_type VARCHAR(40) NOT NULL DEFAULT 'referral_reward_multiplier',
  team_id BIGINT UNSIGNED NULL,
  multiplier DECIMAL(8,4) NOT NULL DEFAULT 1,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_referral_growth_events_active (status, starts_at, ends_at),
  KEY idx_referral_growth_events_team (team_id, status, starts_at, ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO referral_team_name_pool (name) VALUES
  ('Nova'), ('Titan'), ('Phoenix'), ('Orion'), ('Apex'), ('Sentinel'), ('Nebula'), ('Vanguard'), ('Dynasty'), ('Falcon'),
  ('Comet'), ('Eclipse'), ('Zenith'), ('Pulse'), ('Summit'), ('Atlas'), ('Vector'), ('Stellar'), ('Aurora'), ('Quantum'),
  ('Voyager'), ('Pioneer'), ('Crown'), ('Meteor'), ('Rocket'), ('Galaxy'), ('Solar'), ('Lunar'), ('Cosmos'), ('Vertex'),
  ('Prism'), ('Ignite'), ('Fusion'), ('Orbit'), ('Striker'), ('Velocity'), ('Radiant'), ('Legacy'), ('Momentum'), ('Horizon'),
  ('Infinity'), ('Ascend'), ('Beacon'), ('Mirage'), ('Thunder'), ('Blaze'), ('Catalyst'), ('Odyssey'), ('Nexus'), ('Empire')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO referral_growth_settings (`key`, value, description) VALUES
  ('first_referral_bonus_amount', '0.05', 'One-time bonus after the first verified referral'),
  ('team_league_unlock_referrals', '10', 'Verified referrals required to unlock team league'),
  ('team_capacity', '50', 'Maximum members per active referral team before expansion'),
  ('active_team_seed_count', '3', 'Minimum active referral teams to keep available'),
  ('team_best_reward', '15', 'Best team sprint reward pool'),
  ('team_second_reward', '8', 'Second team sprint reward pool'),
  ('team_third_reward', '4', 'Third team sprint reward pool'),
  ('near_winner_gap_referrals', '2', 'Referral gap for near-winner alerts')
ON DUPLICATE KEY UPDATE value = value;

INSERT INTO referral_milestones (scope, threshold_count, reward_type, reward_amount, reward_label) VALUES
  ('user', 3, 'withdrawable_balance', 0.10, '3 verified referrals'),
  ('user', 10, 'withdrawable_balance', 0.25, '10 verified referrals'),
  ('user', 25, 'bonus_reward', 1.00, '25 verified referrals'),
  ('user', 50, 'mystery_reward', 2.50, '50 verified referrals'),
  ('user', 100, 'withdrawable_balance', 7.50, '100 verified referrals'),
  ('team', 100, 'withdrawable_balance', 5.00, '100 team referrals'),
  ('team', 250, 'withdrawable_balance', 15.00, '250 team referrals'),
  ('team', 500, 'withdrawable_balance', 40.00, '500 team referrals')
ON DUPLICATE KEY UPDATE reward_label = VALUES(reward_label);
