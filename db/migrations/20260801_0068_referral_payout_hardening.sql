-- Additive, idempotent referral payout hardening for MariaDB 11.4 / MySQL 8.4.
-- Deployment-month policy: budget counters begin at migration time. Historical paid
-- ledger rows from earlier in the partial month are not imported into the new counters.

DELIMITER $$
DROP PROCEDURE IF EXISTS ensure_referral_hardening_columns$$
CREATE PROCEDURE ensure_referral_hardening_columns()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='referral_reward_ledger' AND column_name='idempotency_key') THEN ALTER TABLE referral_reward_ledger ADD COLUMN idempotency_key VARCHAR(191) NULL AFTER id; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='referral_reward_ledger' AND column_name='source_type') THEN ALTER TABLE referral_reward_ledger ADD COLUMN source_type VARCHAR(40) NULL AFTER sprint_id; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='referral_reward_ledger' AND column_name='source_id') THEN ALTER TABLE referral_reward_ledger ADD COLUMN source_id BIGINT UNSIGNED NULL AFTER source_type; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='referral_reward_ledger' AND column_name='milestone_id') THEN ALTER TABLE referral_reward_ledger ADD COLUMN milestone_id BIGINT UNSIGNED NULL AFTER source_id; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='referral_reward_ledger' AND column_name='eligibility_snapshot') THEN ALTER TABLE referral_reward_ledger ADD COLUMN eligibility_snapshot JSON NULL AFTER metadata; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='referral_reward_ledger' AND column_name='eligible_at') THEN ALTER TABLE referral_reward_ledger ADD COLUMN eligible_at DATETIME NULL AFTER eligibility_snapshot; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='referral_reward_ledger' AND column_name='settled_amount') THEN ALTER TABLE referral_reward_ledger ADD COLUMN settled_amount DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER eligible_at; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='referral_reward_ledger' AND column_name='reversal_reference') THEN ALTER TABLE referral_reward_ledger ADD COLUMN reversal_reference VARCHAR(191) NULL AFTER settled_amount; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='referrals' AND column_name='sprint_eligibility_status') THEN ALTER TABLE referrals ADD COLUMN sprint_eligibility_status VARCHAR(30) NOT NULL DEFAULT 'pending' AFTER self_referral_blocked; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='referrals' AND column_name='sprint_exclusion_reason') THEN ALTER TABLE referrals ADD COLUMN sprint_exclusion_reason VARCHAR(80) NULL AFTER sprint_eligibility_status; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='referrals' AND column_name='sprint_eligibility_snapshot') THEN ALTER TABLE referrals ADD COLUMN sprint_eligibility_snapshot JSON NULL AFTER sprint_exclusion_reason; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='referrals' AND column_name='sprint_eligibility_checked_at') THEN ALTER TABLE referrals ADD COLUMN sprint_eligibility_checked_at DATETIME NULL AFTER sprint_eligibility_snapshot; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='referral_sprint_winners' AND column_name='eligibility_snapshot') THEN ALTER TABLE referral_sprint_winners ADD COLUMN eligibility_snapshot JSON NULL AFTER paid_at; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='referral_team_rewards' AND column_name='eligibility_snapshot') THEN ALTER TABLE referral_team_rewards ADD COLUMN eligibility_snapshot JSON NULL AFTER paid_at; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='referral_milestone_claims' AND column_name='eligibility_snapshot') THEN ALTER TABLE referral_milestone_claims ADD COLUMN eligibility_snapshot JSON NULL AFTER metadata; END IF;
END$$
CALL ensure_referral_hardening_columns()$$
DROP PROCEDURE ensure_referral_hardening_columns$$

DROP PROCEDURE IF EXISTS ensure_referral_hardening_indexes$$
CREATE PROCEDURE ensure_referral_hardening_indexes()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='referral_reward_ledger' AND index_name='uniq_referral_reward_idempotency') THEN
    CREATE UNIQUE INDEX uniq_referral_reward_idempotency ON referral_reward_ledger (idempotency_key);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='referral_reward_ledger' AND index_name='idx_referral_reward_pending_budget') THEN
    CREATE INDEX idx_referral_reward_pending_budget ON referral_reward_ledger (status, eligible_at, user_id);
  END IF;
END$$
CALL ensure_referral_hardening_indexes()$$
DROP PROCEDURE ensure_referral_hardening_indexes$$
DELIMITER ;

CREATE TABLE IF NOT EXISTS referral_budget_usage (
  scope_type VARCHAR(24) NOT NULL,
  user_id INT NOT NULL DEFAULT 0,
  period_start DATE NOT NULL,
  spent_amount DECIMAL(18,8) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (scope_type, user_id, period_start),
  CONSTRAINT chk_referral_budget_nonnegative CHECK (spent_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referral_commission_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  idempotency_key VARCHAR(191) NOT NULL,
  referrer_user_id INT NOT NULL,
  referred_publisher_id INT NOT NULL,
  source_settlement_type VARCHAR(24) NOT NULL,
  source_settlement_id BIGINT UNSIGNED NOT NULL,
  gross_publisher_amount DECIMAL(18,8) NOT NULL,
  commission_rate DECIMAL(9,8) NOT NULL DEFAULT 0.05000000,
  amount DECIMAL(18,8) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  referral_ledger_id BIGINT UNSIGNED NULL,
  eligibility_snapshot JSON NULL,
  eligible_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at DATETIME NULL,
  reversal_reference VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_referral_commission_key (idempotency_key),
  KEY idx_referral_commission_lifetime (referred_publisher_id, status),
  KEY idx_referral_commission_referrer (referrer_user_id, status, eligible_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO referral_growth_settings (`key`,value,description) VALUES
  ('referral_join_reward_amount','0.005','Registration reward for one valid referral'),
  ('referral_verification_reward_amount','0.010','Additional valid channel verification reward'),
  ('referral_reward_amount','0.015','Maximum ordinary reward for one valid referral'),
  ('sprint_first_place_reward','1.00','Future unsettled first-place individual sprint prize'),
  ('sprint_second_place_reward','0.50','Future unsettled second-place individual sprint prize'),
  ('sprint_third_place_reward','0.25','Future unsettled third-place individual sprint prize'),
  ('team_best_reward','1.50','Future unsettled first-team total prize pool'),
  ('team_second_reward','0.75','Future unsettled second-team total prize pool'),
  ('team_third_reward','0.25','Future unsettled third-team total prize pool'),
  ('referral_user_daily_cap','0.50','Maximum referral-related settlement per user per calendar day'),
  ('referral_user_monthly_cap','5.00','Maximum referral-related settlement per user per calendar month'),
  ('referral_platform_monthly_cap','25.00','Maximum platform referral and sprint settlement per calendar month'),
  ('referral_sprint_user_cap','1.50','Maximum total sprint award to one user in one sprint'),
  ('referral_publisher_commission_lifetime_cap','1.00','Lifetime recurring commission cap per referred publisher'),
  ('referral_team_milestones_enabled','0','Future team milestone payouts are disabled')
ON DUPLICATE KEY UPDATE value=VALUES(value),description=VALUES(description);

-- Update only active/unsettled sprint outcomes. Archived history is untouched.
UPDATE referral_sprints
SET first_place_reward=1.00000000, second_place_reward=0.50000000, third_place_reward=0.25000000,
    best_team_reward=1.50000000, second_team_reward=0.75000000, third_team_reward=0.25000000
WHERE status='active' AND rewards_paid_at IS NULL;

-- Preserve claims/history; only definitions governing future qualification change.
UPDATE referral_milestones SET status='inactive'
WHERE scope='team' AND status='active';
UPDATE referral_milestones SET status='inactive'
WHERE scope='user' AND threshold_count=30 AND status='active';

INSERT INTO referral_milestones (scope,threshold_count,reward_type,reward_amount,reward_label,status)
VALUES
 ('user',3,'withdrawable_balance',0.02000000,'3 valid active referrals','active'),
 ('user',10,'withdrawable_balance',0.05000000,'10 valid active referrals','active'),
 ('user',25,'withdrawable_balance',0.15000000,'25 valid active referrals','active'),
 ('user',50,'withdrawable_balance',0.30000000,'50 valid active referrals','active'),
 ('user',100,'withdrawable_balance',0.75000000,'100 valid active referrals','active'),
 ('user',200,'withdrawable_balance',1.50000000,'200 valid active referrals','active'),
 ('user',500,'withdrawable_balance',3.00000000,'500 valid active referrals','active')
ON DUPLICATE KEY UPDATE reward_label=VALUES(reward_label),status='active';

-- Deactivate competing definitions while keeping only the canonical amount active.
UPDATE referral_milestones
SET status=CASE WHEN
  (threshold_count=3 AND reward_amount=0.02000000) OR
  (threshold_count=10 AND reward_amount=0.05000000) OR
  (threshold_count=25 AND reward_amount=0.15000000) OR
  (threshold_count=50 AND reward_amount=0.30000000) OR
  (threshold_count=100 AND reward_amount=0.75000000) OR
  (threshold_count=200 AND reward_amount=1.50000000) OR
  (threshold_count=500 AND reward_amount=3.00000000)
  THEN 'active' ELSE 'inactive' END
WHERE scope='user' AND threshold_count IN (3,10,25,50,100,200,500);
