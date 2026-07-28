-- Normalize the advertiser ledger description contract without changing existing values.
-- Safe after either a fresh install or the historical VARCHAR(255) NOT NULL production shape.

SET @description_is_compatible = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'advertiser_transactions'
    AND COLUMN_NAME = 'description'
    AND DATA_TYPE = 'text'
    AND IS_NULLABLE = 'YES'
);

SET @description_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'advertiser_transactions'
    AND COLUMN_NAME = 'description'
);

SET @description_sql = CASE
  WHEN @description_exists = 0 THEN
    'ALTER TABLE advertiser_transactions ADD COLUMN description TEXT NULL AFTER type'
  WHEN @description_is_compatible = 0 THEN
    'ALTER TABLE advertiser_transactions MODIFY COLUMN description TEXT NULL'
  ELSE
    'SELECT 1'
END;

PREPARE description_statement FROM @description_sql;
EXECUTE description_statement;
DEALLOCATE PREPARE description_statement;
