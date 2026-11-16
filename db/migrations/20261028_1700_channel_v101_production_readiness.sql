-- ==============================================================================
-- Migration: 20261028_1700_channel_v101_production_readiness.sql
-- Project: AdsGalaxy V1.01 — Channel Earnings V1.01 (Phase 7)
-- Objective: Consolidated schema reconciliation, ENUM compatibility repair,
--            missing table safeguards, and singleton treasury control.
--
-- STATUS: PREPARED ONLY. DO NOT EXECUTE AUTOMATICALLY IN PRODUCTION.
-- ==============================================================================

-- 1) Reconcile columns and ENUM values on channel_cpc_reserve_advances
--    Accommodates environments regardless of whether 0158, 1500, or 1600 ran first.
ALTER TABLE channel_cpc_reserve_advances
  ADD COLUMN IF NOT EXISTS post_id INT NULL AFTER publisher_id,
  ADD COLUMN IF NOT EXISTS channel_id INT NULL AFTER post_id,
  ADD COLUMN IF NOT EXISTS unfunded_queue_amount DECIMAL(24,8) NOT NULL DEFAULT 0.00000000 AFTER recovered_amount;

-- Fix ENUM discrepancy: 0158 lacked 'partially_recovered' & 'fully_recovered'; 1500 lacked 'recovered'.
-- This union ENUM ensures zero truncation or strict-mode errors across all settlement code paths.
ALTER TABLE channel_cpc_reserve_advances
  MODIFY COLUMN status ENUM('open','fully_recovered','partially_recovered','recovered','exhausted','reversed') NOT NULL DEFAULT 'open';

-- 2) Ensure channel_arr_transitions exists (audit trail for ARR recoveries)
CREATE TABLE IF NOT EXISTS channel_arr_transitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  idempotency_key VARCHAR(191) NOT NULL,
  advance_id BIGINT UNSIGNED NOT NULL,
  campaign_id INT NOT NULL,
  post_id INT NOT NULL,
  publisher_id INT NOT NULL,
  click_id BIGINT UNSIGNED NOT NULL,
  gross_click_unit_price DECIMAL(24,8) NOT NULL,
  publisher_click_share DECIMAL(24,8) NOT NULL,
  arr_recovered_amount DECIMAL(24,8) NOT NULL,
  publisher_net_credit DECIMAL(24,8) NOT NULL,
  prior_advance_balance DECIMAL(24,8) NOT NULL,
  new_advance_balance DECIMAL(24,8) NOT NULL,
  policy_version VARCHAR(64) NOT NULL DEFAULT 'adsgalaxy-v1.01-reserve',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_arr_transition_key (idempotency_key),
  KEY idx_arr_advance_id (advance_id),
  KEY idx_arr_campaign_pub (campaign_id, publisher_id),
  KEY idx_arr_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) Ensure channel_cpc_reserve_advance_posts exists (post attribution under 0.10 cap)
CREATE TABLE IF NOT EXISTS channel_cpc_reserve_advance_posts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  advance_id BIGINT UNSIGNED NOT NULL,
  campaign_id INT NOT NULL,
  post_id INT NOT NULL,
  channel_id INT NOT NULL,
  publisher_id INT NOT NULL,
  eligible_views INT UNSIGNED NOT NULL DEFAULT 0,
  allocated_advance DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  recovered_amount DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_advance_post (post_id),
  KEY idx_advance_post_advance_id (advance_id),
  KEY idx_advance_post_campaign_pub (campaign_id, publisher_id),
  CONSTRAINT fk_advance_post_advance FOREIGN KEY (advance_id) REFERENCES channel_cpc_reserve_advances (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4) Ensure channel_reserve_treasury_control singleton exists
CREATE TABLE IF NOT EXISTS channel_reserve_treasury_control (
  id INT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  total_realized_inflow DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  total_authorized_advances DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  total_recovered_arr DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  total_adjustments DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Safely initialize singleton control record
INSERT IGNORE INTO channel_reserve_treasury_control (id, version) VALUES (1, 1);

-- 5) Ensure channel_unified_settlement_events exists (idempotency ledger)
CREATE TABLE IF NOT EXISTS channel_unified_settlement_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  idempotency_key VARCHAR(191) NOT NULL,
  settlement_type ENUM('cpc_click','cpc_zero_click_advance','cpm_view') NOT NULL,
  campaign_id INT NOT NULL,
  post_id INT NOT NULL,
  channel_id INT NOT NULL,
  publisher_id INT NOT NULL,
  advertiser_id INT NOT NULL,
  units INT UNSIGNED NOT NULL DEFAULT 1,
  unit_price DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  advertiser_debit DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  publisher_credit DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  platform_revenue DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  reserve_contribution DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  arr_recovered DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  status ENUM('settled','reversed','failed') NOT NULL DEFAULT 'settled',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_unified_settlement_key (idempotency_key),
  KEY idx_unified_settlement_campaign (campaign_id),
  KEY idx_unified_settlement_post (post_id),
  KEY idx_unified_settlement_publisher (publisher_id),
  KEY idx_unified_settlement_type_date (settlement_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
