-- Safely widen only legacy ENUM campaign statuses while preserving nullability
-- and the production column default. ALTER TABLE keeps existing values and indexes.
SET @campaign_status_type = (
  SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaigns' AND COLUMN_NAME = 'status'
  LIMIT 1
);
SET @campaign_status_nullable = (
  SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaigns' AND COLUMN_NAME = 'status'
  LIMIT 1
);
SET @campaign_status_default = (
  SELECT COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaigns' AND COLUMN_NAME = 'status'
  LIMIT 1
);
SET @campaign_status_default_clause = IF(
  @campaign_status_default IS NULL,
  IF(@campaign_status_nullable = 'YES', ' DEFAULT NULL', ''),
  CONCAT(' DEFAULT ', QUOTE(@campaign_status_default))
);
SET @campaign_status_sql = IF(
  @campaign_status_type LIKE 'enum%',
  CONCAT('ALTER TABLE campaigns MODIFY COLUMN status VARCHAR(40) ',
    IF(@campaign_status_nullable = 'YES', 'NULL', 'NOT NULL'),
    @campaign_status_default_clause),
  'SELECT 1'
);
PREPARE campaign_status_stmt FROM @campaign_status_sql;
EXECUTE campaign_status_stmt;
DEALLOCATE PREPARE campaign_status_stmt;
