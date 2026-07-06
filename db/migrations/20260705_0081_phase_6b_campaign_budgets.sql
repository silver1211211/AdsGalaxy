-- Phase 6B: immutable total budgets and safe remaining-budget backfill.
-- Existing spend ledgers are preserved; no analytics or historical rows are reset.

SET @has_total_budget = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaigns' AND COLUMN_NAME = 'total_budget'
);
SET @sql = IF(@has_total_budget = 0,
  'ALTER TABLE campaigns ADD COLUMN total_budget DECIMAL(18,8) NULL AFTER budget',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE campaigns c
LEFT JOIN (
  SELECT campaign_id, COALESCE(SUM(advertiser_debit), 0) spend
  FROM channel_settlement_ledger GROUP BY campaign_id
) channel_spend ON channel_spend.campaign_id = c.id
LEFT JOIN (
  SELECT campaign_id, COALESCE(SUM(cost), 0) spend
  FROM broadcast_deliveries WHERE status = 'sent' GROUP BY campaign_id
) bot_spend ON bot_spend.campaign_id = c.id
SET c.total_budget = GREATEST(COALESCE(c.budget, 0) +
  CASE WHEN c.type = 'broadcast' THEN COALESCE(bot_spend.spend, 0) ELSE COALESCE(channel_spend.spend, 0) END, 0)
WHERE c.total_budget IS NULL;

ALTER TABLE campaigns MODIFY COLUMN total_budget DECIMAL(18,8) NOT NULL DEFAULT 0;

-- Undo the old PAYG backfill without inventing spend: budget is the lifetime cap,
-- while the impression ledger is the source of truth for spend.
UPDATE miniapp_rewarded_campaigns c
LEFT JOIN (
  SELECT campaign_id, COALESCE(SUM(advertiser_debit), SUM(cost), 0) spend
  FROM miniapp_internal_ad_impressions GROUP BY campaign_id
) ledger ON ledger.campaign_id = c.id
SET c.total_spend = COALESCE(ledger.spend, 0),
    c.remaining_budget = GREATEST(COALESCE(c.budget, 0) - COALESCE(ledger.spend, 0), 0),
    c.campaign_budget_mode = 'custom'
WHERE COALESCE(c.budget, 0) > 0;
