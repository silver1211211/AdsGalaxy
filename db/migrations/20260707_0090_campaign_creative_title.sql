-- Adds a delivered creative title for channel and bot campaigns.
-- Idempotent and safe after partial deploys: existing campaigns receive a neutral title.

SET @campaign_title_column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'campaigns'
    AND COLUMN_NAME = 'campaign_title'
);

SET @campaign_title_sql = IF(
  @campaign_title_column_exists = 0,
  'ALTER TABLE `campaigns` ADD COLUMN `campaign_title` VARCHAR(255) NULL AFTER `name`',
  'SELECT 1'
);
PREPARE campaign_title_stmt FROM @campaign_title_sql;
EXECUTE campaign_title_stmt;
DEALLOCATE PREPARE campaign_title_stmt;

UPDATE campaigns
SET campaign_title = 'Ads'
WHERE campaign_title IS NULL OR TRIM(campaign_title) = '';
