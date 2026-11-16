-- ==============================================================================
-- Migration: 20261028_1600_channel_v101_unified_settlement.sql
-- Project: AdsGalaxy V1.01 — Channel Earnings V1.01 (Phase 6)
-- Objective: Unified Channel Settlement, Shared Treasury Concurrency Control,
--            Publisher-Campaign Cap Enforcement, and Multi-Post Attribution.
--
-- STATUS: PREPARED ONLY. DO NOT EXECUTE AUTOMATICALLY IN PRODUCTION.
-- ==============================================================================

-- 1) Reconcile and ensure additive columns on channel_cpc_reserve_advances
--    Guarantees compatibility regardless of whether 20261028_0158 or 20261028_1500 was run first.
ALTER TABLE channel_cpc_reserve_advances
  ADD COLUMN IF NOT EXISTS post_id INT NULL AFTER publisher_id,
  ADD COLUMN IF NOT EXISTS channel_id INT NULL AFTER post_id,
  ADD COLUMN IF NOT EXISTS unfunded_queue_amount DECIMAL(24,8) NOT NULL DEFAULT 0.00000000 AFTER recovered_amount;

-- 2) Dedicated post-level attribution table under the publisher-campaign cap
--    Tracks individual post view metrics while the primary table enforces the
--    0.10000000 USDT cumulative ceiling per (campaign_id, publisher_id).
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

-- 3) Shared Reserve Treasury concurrency control
--    Singleton record used for row-level locking (`SELECT ... FOR UPDATE`) during advance allocation
--    to guarantee atomic multi-worker serializability without racing against the 30% protected floor.
CREATE TABLE IF NOT EXISTS channel_reserve_treasury_control (
  id INT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  total_realized_inflow DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  total_authorized_advances DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  total_recovered_arr DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  total_adjustments DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed the singleton row if absent
INSERT IGNORE INTO channel_reserve_treasury_control (id, version) VALUES (1, 1);

-- 4) Unified Settlement idempotency and tracking ledger
--    Single canonical table preventing double-debits, double-credits, and race conditions
--    between real-time Fast Billing and legacy batch settlement.
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
