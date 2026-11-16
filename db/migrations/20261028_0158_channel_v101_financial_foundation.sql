-- AdsGalaxy V1.01 financial foundation (Phase 2) -- PREPARED, NOT APPLIED.
-- Owner-approved execution only. Additive: no DROP, no DELETE/UPDATE/INSERT,
-- no data seeding, no reserve funding. Requires 20260801_0108 (channel_allocation_ledger).
-- Existing rows, constraints, hashes and source keys are untouched; legacy rows
-- keep the new nullable columns at NULL and remain interpretable under their
-- original policy_version.

-- 1) Signed quality-adjustment support on the canonical allocation ledger.
--    The legacy bucket column quality_adjustment (>= 0, part of the legacy
--    invariant) is NOT modified. V1.01 rows write 0 there and carry the signed
--    publisher delta below, which is already contained inside
--    publisher_allocation / reserve_allocation.
ALTER TABLE channel_allocation_ledger
  ADD COLUMN IF NOT EXISTS publisher_base_allocation DECIMAL(24,8) NULL AFTER quality_adjustment,
  ADD COLUMN IF NOT EXISTS reserve_base_allocation DECIMAL(24,8) NULL AFTER publisher_base_allocation,
  ADD COLUMN IF NOT EXISTS quality_adjustment_signed DECIMAL(24,8) NULL AFTER reserve_base_allocation,
  ADD COLUMN IF NOT EXISTS quality_multiplier DECIMAL(10,8) NULL AFTER quality_adjustment_signed,
  ADD COLUMN IF NOT EXISTS split_publisher_percent DECIMAL(11,8) NULL AFTER quality_multiplier,
  ADD COLUMN IF NOT EXISTS split_platform_percent DECIMAL(11,8) NULL AFTER split_publisher_percent,
  ADD COLUMN IF NOT EXISTS split_reserve_percent DECIMAL(11,8) NULL AFTER split_platform_percent;

-- New stronger, additive check; the legacy chk_channel_allocation_amounts and
-- chk_channel_allocation_invariant stay in force and continue to hold for V1.01 rows.
SET @ddl=IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='channel_allocation_ledger' AND CONSTRAINT_NAME='chk_channel_allocation_v101_signed')=0,'ALTER TABLE channel_allocation_ledger ADD CONSTRAINT chk_channel_allocation_v101_signed CHECK (quality_adjustment_signed IS NULL OR (policy_version LIKE ''adsgalaxy-v1.01%'' AND quality_adjustment = 0 AND publisher_base_allocation IS NOT NULL AND reserve_base_allocation IS NOT NULL AND quality_multiplier BETWEEN 0.95 AND 1.05 AND publisher_allocation = publisher_base_allocation + quality_adjustment_signed AND reserve_allocation = reserve_base_allocation - quality_adjustment_signed AND publisher_base_allocation >= 0 AND reserve_base_allocation >= 0 AND split_publisher_percent IS NOT NULL AND split_platform_percent IS NOT NULL AND split_reserve_percent IS NOT NULL AND split_publisher_percent + split_platform_percent + split_reserve_percent = 100))','SELECT 1');PREPARE s FROM @ddl;EXECUTE s;DEALLOCATE PREPARE s;

-- 2) Reserve treasury ledger (structure only; created EMPTY; nothing reads or
--    writes it in Phase 2). Funding must come from an owner-verified,
--    reconciled procedure -- never from campaign rollup sums.
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
  policy_version VARCHAR(64) NOT NULL,
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

-- 3) CPC reserve-advance tracking for Automatic Reserve Recovery (structure
--    only, EMPTY). One row per (campaign, publisher). Entitlement accrues from
--    the FIRST valid view up to a 1,000-view / 0.10 USDT ceiling; the engine
--    that writes it belongs to a later phase.
CREATE TABLE IF NOT EXISTS channel_cpc_reserve_advances (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id INT NOT NULL,
  publisher_id INT NOT NULL,
  entitled_views INT UNSIGNED NOT NULL DEFAULT 0,
  entitled_amount DECIMAL(24,8) NOT NULL DEFAULT 0,
  advanced_amount DECIMAL(24,8) NOT NULL DEFAULT 0,
  recovered_amount DECIMAL(24,8) NOT NULL DEFAULT 0,
  status ENUM('open','recovered','reversed') NOT NULL DEFAULT 'open',
  policy_version VARCHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_cpc_reserve_advance_campaign_publisher (campaign_id, publisher_id),
  KEY idx_cpc_reserve_advance_status (status, updated_at),
  CONSTRAINT chk_cpc_reserve_advance_views CHECK (entitled_views <= 1000),
  CONSTRAINT chk_cpc_reserve_advance_amounts CHECK (
    entitled_amount >= 0 AND entitled_amount <= 0.10000000
    AND advanced_amount >= 0 AND advanced_amount <= entitled_amount
    AND recovered_amount >= 0 AND recovered_amount <= advanced_amount
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ROLLBACK NOTE (owner-run only, only if no V1.01 rows were ever written):
--   remove the additions in reverse order: constraint chk_channel_allocation_v101_signed,
--   the seven new columns, then the two new empty tables. No legacy object is altered.
