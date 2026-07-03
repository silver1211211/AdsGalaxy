-- Mini App internal/rewarded ads bill per valid impression from the advertiser's main ad balance.
-- This migration does not affect channel ads, bots, settlements, or external provider revenue.
-- Uses INFORMATION_SCHEMA-guarded PREPARE/EXECUTE throughout: "ADD COLUMN IF NOT EXISTS" and
-- "CREATE INDEX IF NOT EXISTS" are not supported by this MySQL version and would abort the script.

SET @has_total_spend = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_rewarded_campaigns' AND COLUMN_NAME = 'total_spend'
);
SET @sql = IF(@has_total_spend = 0,
  'ALTER TABLE miniapp_rewarded_campaigns ADD COLUMN total_spend DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER remaining_budget',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_impressions = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_rewarded_campaigns' AND COLUMN_NAME = 'impressions'
);
SET @sql = IF(@has_impressions = 0,
  'ALTER TABLE miniapp_rewarded_campaigns ADD COLUMN impressions BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER total_spend',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_pause_reason = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_rewarded_campaigns' AND COLUMN_NAME = 'pause_reason'
);
SET @sql = IF(@has_pause_reason = 0,
  'ALTER TABLE miniapp_rewarded_campaigns ADD COLUMN pause_reason VARCHAR(64) NULL AFTER status',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_advertiser_debit = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_internal_ad_impressions' AND COLUMN_NAME = 'advertiser_debit'
);
SET @sql = IF(@has_advertiser_debit = 0,
  'ALTER TABLE miniapp_internal_ad_impressions ADD COLUMN advertiser_debit DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER cost',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE miniapp_internal_ad_impressions
SET advertiser_debit = cost
WHERE advertiser_debit = 0 AND cost > 0;

UPDATE miniapp_rewarded_campaigns c
LEFT JOIN (
  SELECT campaign_id, COALESCE(SUM(cost), 0) AS spend, COUNT(*) AS impression_count
  FROM miniapp_internal_ad_impressions
  GROUP BY campaign_id
) ledger ON ledger.campaign_id = c.id
SET c.total_spend = COALESCE(ledger.spend, 0),
    c.impressions = COALESCE(ledger.impression_count, 0),
    c.remaining_budget = 0,
    c.campaign_budget_mode = 'pay_as_you_go';

SET @has_payg_index = (
  SELECT COUNT(*)
  FROM (
    SELECT INDEX_NAME
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'miniapp_rewarded_campaigns'
    GROUP BY INDEX_NAME
    HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'status,advertiser_cpm_bid,advertiser_id'
  ) equivalent_indexes
);
SET @sql = IF(@has_payg_index = 0,
  'CREATE INDEX idx_miniapp_rewarded_payg_selection ON miniapp_rewarded_campaigns (status, advertiser_cpm_bid, advertiser_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
