-- Align channel campaign category/status storage with production-safe values.
-- Safe to run more than once; preserves existing rows.

SET @campaign_category_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'campaigns'
    AND COLUMN_NAME = 'category'
);

SET @campaign_category_sql := IF(
  @campaign_category_exists = 0,
  'ALTER TABLE campaigns ADD COLUMN category VARCHAR(32) NULL DEFAULT ''all''',
  'ALTER TABLE campaigns MODIFY COLUMN category VARCHAR(32) NULL DEFAULT ''all'''
);
PREPARE stmt FROM @campaign_category_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE campaigns
SET category = CASE
  WHEN category IS NULL OR TRIM(category) = '' THEN 'all'
  WHEN LOWER(TRIM(category)) IN ('all', 'all categories', 'general', 'uncategorized') THEN 'all'
  WHEN LOWER(TRIM(category)) = 'crypto' THEN 'crypto'
  WHEN LOWER(TRIM(category)) = 'finance' THEN 'finance'
  WHEN LOWER(TRIM(category)) IN ('nsfw', 'nsfw +18', 'nsfw 18', 'nsfw_18', 'adult') THEN 'nsfw_18'
  WHEN LOWER(TRIM(category)) = 'tech' THEN 'tech'
  WHEN LOWER(TRIM(category)) = 'gambling' THEN 'gambling'
  WHEN LOWER(TRIM(category)) = 'entertainment' THEN 'entertainment'
  WHEN LOWER(TRIM(category)) = 'education' THEN 'education'
  WHEN LOWER(TRIM(category)) = 'shopping' THEN 'shopping'
  WHEN LOWER(TRIM(category)) = 'other' THEN 'other'
  ELSE 'all'
END;

ALTER TABLE campaigns MODIFY COLUMN category VARCHAR(32) NOT NULL DEFAULT 'all';

SET @channels_status_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'channels'
    AND COLUMN_NAME = 'status'
);

SET @channels_status_sql := IF(
  @channels_status_exists = 0,
  'ALTER TABLE channels ADD COLUMN status VARCHAR(40) NULL DEFAULT ''pending''',
  'ALTER TABLE channels MODIFY COLUMN status VARCHAR(40) NULL DEFAULT ''pending'''
);
PREPARE stmt FROM @channels_status_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE channels
SET status = 'pending'
WHERE status IS NULL OR TRIM(status) = '';

ALTER TABLE channels MODIFY COLUMN status VARCHAR(40) NOT NULL DEFAULT 'pending';
