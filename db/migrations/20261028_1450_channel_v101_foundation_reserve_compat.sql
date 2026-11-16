-- =============================================================================
-- AdsGalaxy V1.01 Channel Monetization — Foundation & Reserve Schema Alignment
-- Migration: 20261028_1450_channel_v101_foundation_reserve_compat.sql
--
-- Purpose:
--   Reconciles schema differences between 20261028_0158_channel_v101_financial_foundation.sql
--   and 20261028_1500_channel_v101_reserve_treasury_arr.sql while preserving the
--   original migration files and their SHA-256 checksums:
--   1. Sets DEFAULT 'adsgalaxy-v1.01-reserve' on channel_reserve_treasury_ledger.policy_version
--      so 1500's opening-balance INSERT and runtime settlement inserts (which omit
--      policy_version) succeed under MariaDB 11.4 STRICT_TRANS_TABLES.
--   2. Sets DEFAULT 'adsgalaxy-v1.01-reserve' on channel_cpc_reserve_advances.policy_version
--      so runtime zero-click advance inserts succeed.
--   3. Updates chk_cpc_reserve_advance_views on channel_cpc_reserve_advances from
--      (entitled_views <= 1000) to (entitled_views >= 0 AND entitled_views <= 1000000)
--      so posts with >1,000 views can record actual eligible views while
--      chk_cpc_reserve_advance_amounts strictly enforces entitled_amount <= 0.10000000 USDT.
-- =============================================================================

-- 1. Ensure channel_reserve_treasury_ledger.policy_version has the V1.01 default
SET @has_treasury_policy_default := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'channel_reserve_treasury_ledger'
    AND column_name = 'policy_version'
    AND column_default = 'adsgalaxy-v1.01-reserve'
);
SET @sql_treasury_policy_default := IF(
  @has_treasury_policy_default = 0,
  'ALTER TABLE channel_reserve_treasury_ledger MODIFY COLUMN policy_version VARCHAR(64) NOT NULL DEFAULT ''adsgalaxy-v1.01-reserve''',
  'SELECT 1'
);
PREPARE stmt_treasury_policy_default FROM @sql_treasury_policy_default;
EXECUTE stmt_treasury_policy_default;
DEALLOCATE PREPARE stmt_treasury_policy_default;

-- 2. Ensure channel_cpc_reserve_advances.policy_version has the V1.01 default
SET @has_advances_policy_default := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'channel_cpc_reserve_advances'
    AND column_name = 'policy_version'
    AND column_default = 'adsgalaxy-v1.01-reserve'
);
SET @sql_advances_policy_default := IF(
  @has_advances_policy_default = 0,
  'ALTER TABLE channel_cpc_reserve_advances MODIFY COLUMN policy_version VARCHAR(64) NOT NULL DEFAULT ''adsgalaxy-v1.01-reserve''',
  'SELECT 1'
);
PREPARE stmt_advances_policy_default FROM @sql_advances_policy_default;
EXECUTE stmt_advances_policy_default;
DEALLOCATE PREPARE stmt_advances_policy_default;

-- 3. Reconcile chk_cpc_reserve_advance_views to allow up to 1,000,000 recorded views
--    while chk_cpc_reserve_advance_amounts enforces the 0.10 USDT advance ceiling.
SET @chk_views_exists := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'channel_cpc_reserve_advances'
    AND constraint_name = 'chk_cpc_reserve_advance_views'
    AND constraint_type = 'CHECK'
);
SET @chk_views_is_reconciled := (
  SELECT COUNT(*)
  FROM information_schema.check_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'channel_cpc_reserve_advances'
    AND constraint_name = 'chk_cpc_reserve_advance_views'
    AND check_clause LIKE '%1000000%'
);
SET @sql_reconcile_chk_views := CASE
  WHEN @chk_views_exists > 0 AND @chk_views_is_reconciled = 0 THEN
    'ALTER TABLE channel_cpc_reserve_advances DROP CONSTRAINT chk_cpc_reserve_advance_views, ADD CONSTRAINT chk_cpc_reserve_advance_views CHECK (entitled_views >= 0 AND entitled_views <= 1000000)'
  WHEN @chk_views_exists = 0 THEN
    'ALTER TABLE channel_cpc_reserve_advances ADD CONSTRAINT chk_cpc_reserve_advance_views CHECK (entitled_views >= 0 AND entitled_views <= 1000000)'
  ELSE
    'SELECT 1'
END;
PREPARE stmt_reconcile_chk_views FROM @sql_reconcile_chk_views;
EXECUTE stmt_reconcile_chk_views;
DEALLOCATE PREPARE stmt_reconcile_chk_views;
