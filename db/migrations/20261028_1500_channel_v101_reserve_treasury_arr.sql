-- ==============================================================================
-- Migration: 20261028_1500_channel_v101_reserve_treasury_arr.sql
-- Project: AdsGalaxy V1.01 — Channel Earnings V1.01 (Phase 5)
-- Objective: Reserve Treasury Ledger, Zero-Click CPC Advance tracking, and
--            Automatic Reserve Recovery (ARR) transitions.
--
-- STATUS: PREPARED ONLY. DO NOT EXECUTE AUTOMATICALLY IN PRODUCTION.
-- ==============================================================================

-- 1) Reserve treasury ledger (additive table)
-- Tracks all realized reserve inflows, authorized advance payouts, ARR recoveries,
-- quality bonuses, adjustments and reversals with 8-decimal precision.
CREATE TABLE IF NOT EXISTS channel_reserve_treasury_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  idempotency_key VARCHAR(191) NOT NULL,
  entry_type ENUM('allocation_inflow','authorized_funding','advance_outflow','recovery_inflow','quality_bonus_outflow','reversal','adjustment') NOT NULL,
  direction ENUM('in','out') NOT NULL,
  amount DECIMAL(24,8) NOT NULL,
  allocation_event_id CHAR(36) NULL,
  campaign_id INT NULL,
  post_id INT NULL,
  publisher_id INT NULL,
  funding_authorization_ref VARCHAR(191) NULL,
  policy_version VARCHAR(64) NOT NULL DEFAULT 'adsgalaxy-v1.01-reserve',
  metadata JSON NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_reserve_treasury_idempotency (idempotency_key),
  KEY idx_reserve_treasury_type_time (entry_type, created_at),
  KEY idx_reserve_treasury_campaign_publisher (campaign_id, publisher_id),
  KEY idx_reserve_treasury_allocation_event (allocation_event_id),
  CONSTRAINT chk_reserve_treasury_amount_positive CHECK (amount > 0),
  CONSTRAINT chk_reserve_treasury_direction CHECK (
    (entry_type IN ('allocation_inflow','authorized_funding','recovery_inflow') AND direction = 'in')
    OR (entry_type IN ('advance_outflow','quality_bonus_outflow') AND direction = 'out')
    OR entry_type IN ('reversal','adjustment')
  ),
  CONSTRAINT chk_reserve_treasury_funding_ref CHECK (entry_type <> 'authorized_funding' OR funding_authorization_ref IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) CPC zero-click reserve advances (additive table)
-- Tracks eligible view advances per post and publisher. Enforces hard cap at 0.10000000 USDT.
CREATE TABLE IF NOT EXISTS channel_cpc_reserve_advances (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id INT NOT NULL,
  post_id INT NOT NULL,
  publisher_id INT NOT NULL,
  channel_id INT NOT NULL,
  entitled_views INT UNSIGNED NOT NULL DEFAULT 0,
  entitled_amount DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  advanced_amount DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  recovered_amount DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  unfunded_queue_amount DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  status ENUM('open','fully_recovered','partially_recovered','exhausted','reversed') NOT NULL DEFAULT 'open',
  policy_version VARCHAR(64) NOT NULL DEFAULT 'adsgalaxy-v1.01-reserve',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_cpc_reserve_advance_post (post_id),
  KEY idx_cpc_reserve_advance_campaign_publisher (campaign_id, publisher_id),
  KEY idx_cpc_reserve_advance_status (status, updated_at),
  CONSTRAINT chk_cpc_reserve_advance_views CHECK (entitled_views <= 1000000),
  CONSTRAINT chk_cpc_reserve_advance_amounts CHECK (
    entitled_amount >= 0 AND entitled_amount <= 0.10000000
    AND advanced_amount >= 0 AND advanced_amount <= entitled_amount
    AND recovered_amount >= 0 AND recovered_amount <= advanced_amount
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) Automatic Reserve Recovery transitions (additive table)
-- Detailed audit trail for each click recovery event against a funded CPC advance.
CREATE TABLE IF NOT EXISTS channel_arr_transitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  idempotency_key VARCHAR(191) NOT NULL,
  advance_id BIGINT UNSIGNED NOT NULL,
  campaign_id INT NOT NULL,
  post_id INT NOT NULL,
  publisher_id INT NOT NULL,
  click_id BIGINT UNSIGNED NOT NULL,
  gross_click_unit_price DECIMAL(24,8) NOT NULL,
  recovered_to_reserve DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  cash_paid_to_publisher DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  outstanding_advance_after DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  cumulative_publisher_earnings DECIMAL(24,8) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_arr_transition_idempotency (idempotency_key),
  KEY idx_arr_transition_advance (advance_id),
  KEY idx_arr_transition_post_click (post_id, click_id),
  CONSTRAINT fk_arr_transition_advance FOREIGN KEY (advance_id) REFERENCES channel_cpc_reserve_advances (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
