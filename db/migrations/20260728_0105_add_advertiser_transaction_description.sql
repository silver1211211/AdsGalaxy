-- Add the established human-readable ledger description to existing advertiser transaction tables.
-- Existing rows remain valid because the column is nullable and requires no backfill.

SET @description_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'advertiser_transactions'
    AND COLUMN_NAME = 'description'
);

SET @description_sql := IF(
  @description_exists = 0,
  'ALTER TABLE advertiser_transactions ADD COLUMN description TEXT NULL AFTER type',
  'SELECT 1'
);

PREPARE description_statement FROM @description_sql;
EXECUTE description_statement;
DEALLOCATE PREPARE description_statement;
