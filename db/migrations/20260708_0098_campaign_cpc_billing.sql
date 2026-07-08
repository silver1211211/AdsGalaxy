-- Add explicit click campaign CPC/eCPC bid storage.
-- Existing click campaigns used campaigns.cpm as the per-1000-click bid, so
-- preserve that value for future unsettled click units without touching
-- historical settlement ledgers or settled counters.

SET @campaign_cpc_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'campaigns'
    AND COLUMN_NAME = 'cpc'
);

SET @campaign_cpc_sql := IF(
  @campaign_cpc_exists = 0,
  'ALTER TABLE campaigns ADD COLUMN cpc DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER cpm',
  'SELECT 1'
);
PREPARE stmt FROM @campaign_cpc_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE campaigns
SET cpc = cpm
WHERE type = 'clicks'
  AND COALESCE(cpc, 0) = 0
  AND COALESCE(cpm, 0) > 0;
