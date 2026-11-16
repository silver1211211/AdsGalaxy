-- =============================================================================
-- AdsGalaxy V1.01 Channel Monetization — ARR Transitions & Pricing Reconciliation
-- Migration: 20261028_1750_channel_v101_arr_and_pricing_reconciliation.sql
--
-- Purpose:
--   1. Reconciles channel_arr_transitions between 20261028_1500 and 20261028_1700
--      so that all columns, safe defaults, indexes, foreign keys, and CHECK
--      constraints required by runtime settlement engines, reconciliation queries,
--      and tests are present.
--   2. Ensures channel_cpc_reserve_advances has idx_cpc_reserve_advance_post (post_id)
--      for post-level lookup efficiency while preserving uniq_cpc_reserve_advance_campaign_publisher.
--   3. Establishes the approved V1.01 Channel CPM (3 / 5 / 20 USDT) and Channel CPC
--      (65 / 76 / 300 USDT) settings in the authoritative settings table without
--      modifying grandfathered active campaigns.
-- =============================================================================

-- 1. Ensure 1500 columns on channel_arr_transitions have safe defaults for dual-schema compatibility
ALTER TABLE channel_arr_transitions
  MODIFY COLUMN gross_click_unit_price DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  MODIFY COLUMN recovered_to_reserve DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  MODIFY COLUMN cash_paid_to_publisher DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  MODIFY COLUMN outstanding_advance_after DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  MODIFY COLUMN cumulative_publisher_earnings DECIMAL(24,8) NOT NULL DEFAULT 0.00000000;

-- 2. Add occurred_at if missing
SET @has_arr_occurred_at := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'channel_arr_transitions' AND column_name = 'occurred_at'
);
SET @sql_arr_occurred_at := IF(
  @has_arr_occurred_at = 0,
  'ALTER TABLE channel_arr_transitions ADD COLUMN occurred_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) AFTER cumulative_publisher_earnings',
  'SELECT 1'
);
PREPARE stmt_arr_occurred_at FROM @sql_arr_occurred_at;
EXECUTE stmt_arr_occurred_at;
DEALLOCATE PREPARE stmt_arr_occurred_at;

-- 3. Add 1700 columns to channel_arr_transitions if missing
SET @has_arr_pub_click_share := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'channel_arr_transitions' AND column_name = 'publisher_click_share'
);
SET @sql_arr_pub_click_share := IF(
  @has_arr_pub_click_share = 0,
  'ALTER TABLE channel_arr_transitions ADD COLUMN publisher_click_share DECIMAL(24,8) NOT NULL DEFAULT 0.00000000 AFTER gross_click_unit_price',
  'SELECT 1'
);
PREPARE stmt_arr_pub_click_share FROM @sql_arr_pub_click_share;
EXECUTE stmt_arr_pub_click_share;
DEALLOCATE PREPARE stmt_arr_pub_click_share;

SET @has_arr_recovered_amount := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'channel_arr_transitions' AND column_name = 'arr_recovered_amount'
);
SET @sql_arr_recovered_amount := IF(
  @has_arr_recovered_amount = 0,
  'ALTER TABLE channel_arr_transitions ADD COLUMN arr_recovered_amount DECIMAL(24,8) NOT NULL DEFAULT 0.00000000 AFTER recovered_to_reserve',
  'SELECT 1'
);
PREPARE stmt_arr_recovered_amount FROM @sql_arr_recovered_amount;
EXECUTE stmt_arr_recovered_amount;
DEALLOCATE PREPARE stmt_arr_recovered_amount;

SET @has_arr_pub_net_credit := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'channel_arr_transitions' AND column_name = 'publisher_net_credit'
);
SET @sql_arr_pub_net_credit := IF(
  @has_arr_pub_net_credit = 0,
  'ALTER TABLE channel_arr_transitions ADD COLUMN publisher_net_credit DECIMAL(24,8) NOT NULL DEFAULT 0.00000000 AFTER cash_paid_to_publisher',
  'SELECT 1'
);
PREPARE stmt_arr_pub_net_credit FROM @sql_arr_pub_net_credit;
EXECUTE stmt_arr_pub_net_credit;
DEALLOCATE PREPARE stmt_arr_pub_net_credit;

SET @has_arr_prior_balance := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'channel_arr_transitions' AND column_name = 'prior_advance_balance'
);
SET @sql_arr_prior_balance := IF(
  @has_arr_prior_balance = 0,
  'ALTER TABLE channel_arr_transitions ADD COLUMN prior_advance_balance DECIMAL(24,8) NOT NULL DEFAULT 0.00000000 AFTER publisher_net_credit',
  'SELECT 1'
);
PREPARE stmt_arr_prior_balance FROM @sql_arr_prior_balance;
EXECUTE stmt_arr_prior_balance;
DEALLOCATE PREPARE stmt_arr_prior_balance;

SET @has_arr_new_balance := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'channel_arr_transitions' AND column_name = 'new_advance_balance'
);
SET @sql_arr_new_balance := IF(
  @has_arr_new_balance = 0,
  'ALTER TABLE channel_arr_transitions ADD COLUMN new_advance_balance DECIMAL(24,8) NOT NULL DEFAULT 0.00000000 AFTER outstanding_advance_after',
  'SELECT 1'
);
PREPARE stmt_arr_new_balance FROM @sql_arr_new_balance;
EXECUTE stmt_arr_new_balance;
DEALLOCATE PREPARE stmt_arr_new_balance;

SET @has_arr_policy_version := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'channel_arr_transitions' AND column_name = 'policy_version'
);
SET @sql_arr_policy_version := IF(
  @has_arr_policy_version = 0,
  'ALTER TABLE channel_arr_transitions ADD COLUMN policy_version VARCHAR(64) NOT NULL DEFAULT ''adsgalaxy-v1.01-reserve'' AFTER cumulative_publisher_earnings',
  'SELECT 1'
);
PREPARE stmt_arr_policy_version FROM @sql_arr_policy_version;
EXECUTE stmt_arr_policy_version;
DEALLOCATE PREPARE stmt_arr_policy_version;

-- 4. Add 1700 indexes to channel_arr_transitions if missing
SET @has_idx_arr_campaign_pub := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'channel_arr_transitions' AND index_name = 'idx_arr_campaign_pub'
);
SET @sql_idx_arr_campaign_pub := IF(
  @has_idx_arr_campaign_pub = 0,
  'ALTER TABLE channel_arr_transitions ADD KEY idx_arr_campaign_pub (campaign_id, publisher_id)',
  'SELECT 1'
);
PREPARE stmt_idx_arr_campaign_pub FROM @sql_idx_arr_campaign_pub;
EXECUTE stmt_idx_arr_campaign_pub;
DEALLOCATE PREPARE stmt_idx_arr_campaign_pub;

SET @has_idx_arr_created := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'channel_arr_transitions' AND index_name = 'idx_arr_created'
);
SET @sql_idx_arr_created := IF(
  @has_idx_arr_created = 0,
  'ALTER TABLE channel_arr_transitions ADD KEY idx_arr_created (created_at)',
  'SELECT 1'
);
PREPARE stmt_idx_arr_created FROM @sql_idx_arr_created;
EXECUTE stmt_idx_arr_created;
DEALLOCATE PREPARE stmt_idx_arr_created;

-- 5. Update chk_arr_transition_split to validate all 1500 and 1700 monetary columns
SET @chk_arr_split_exists := (
  SELECT COUNT(*) FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE() AND table_name = 'channel_arr_transitions'
    AND constraint_name = 'chk_arr_transition_split' AND constraint_type = 'CHECK'
);
SET @chk_arr_split_reconciled := (
  SELECT COUNT(*) FROM information_schema.check_constraints
  WHERE constraint_schema = DATABASE() AND table_name = 'channel_arr_transitions'
    AND constraint_name = 'chk_arr_transition_split' AND check_clause LIKE '%publisher_click_share%'
);
SET @sql_reconcile_chk_arr_split := CASE
  WHEN @chk_arr_split_exists > 0 AND @chk_arr_split_reconciled = 0 THEN
    'ALTER TABLE channel_arr_transitions DROP CONSTRAINT chk_arr_transition_split, ADD CONSTRAINT chk_arr_transition_split CHECK (recovered_to_reserve >= 0 AND cash_paid_to_publisher >= 0 AND outstanding_advance_after >= 0 AND cumulative_publisher_earnings >= 0 AND publisher_click_share >= 0 AND arr_recovered_amount >= 0 AND publisher_net_credit >= 0 AND prior_advance_balance >= 0 AND new_advance_balance >= 0)'
  WHEN @chk_arr_split_exists = 0 THEN
    'ALTER TABLE channel_arr_transitions ADD CONSTRAINT chk_arr_transition_split CHECK (recovered_to_reserve >= 0 AND cash_paid_to_publisher >= 0 AND outstanding_advance_after >= 0 AND cumulative_publisher_earnings >= 0 AND publisher_click_share >= 0 AND arr_recovered_amount >= 0 AND publisher_net_credit >= 0 AND prior_advance_balance >= 0 AND new_advance_balance >= 0)'
  ELSE
    'SELECT 1'
END;
PREPARE stmt_reconcile_chk_arr_split FROM @sql_reconcile_chk_arr_split;
EXECUTE stmt_reconcile_chk_arr_split;
DEALLOCATE PREPARE stmt_reconcile_chk_arr_split;

-- 6. Ensure channel_cpc_reserve_advances has idx_cpc_reserve_advance_post (post_id)
SET @has_idx_cpc_adv_post := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'channel_cpc_reserve_advances' AND index_name = 'idx_cpc_reserve_advance_post'
);
SET @sql_idx_cpc_adv_post := IF(
  @has_idx_cpc_adv_post = 0,
  'ALTER TABLE channel_cpc_reserve_advances ADD KEY idx_cpc_reserve_advance_post (post_id)',
  'SELECT 1'
);
PREPARE stmt_idx_cpc_adv_post FROM @sql_idx_cpc_adv_post;
EXECUTE stmt_idx_cpc_adv_post;
DEALLOCATE PREPARE stmt_idx_cpc_adv_post;

-- 7. Establish V1.01 Channel CPM (3 / 5 / 20 USDT) and Channel CPC (65 / 76 / 300 USDT) pricing settings
--    Existing campaigns keep their grandfathered campaigns.cpm / campaigns.cpc values untouched.
INSERT INTO settings (`key`, `value`, description) VALUES
  ('min_cpm_views', '3', 'Minimum CPM for channel view campaigns.'),
  ('recommended_cpm_views', '5', 'Recommended CPM for channel view campaigns.'),
  ('max_cpm_views', '20', 'Maximum CPM for channel view campaigns.'),
  ('min_cpm_clicks', '65', 'Minimum CPM for channel click campaigns.'),
  ('recommended_cpm_clicks', '76', 'Recommended CPM for channel click campaigns.'),
  ('max_cpm_clicks', '300', 'Maximum CPM for channel click campaigns.')
ON DUPLICATE KEY UPDATE
  `value` = VALUES(`value`),
  description = COALESCE(description, VALUES(description));
