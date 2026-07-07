-- Keep campaign category storage compatible with the application category list.
-- This is additive/idempotent and preserves existing campaign rows.

SET @category_column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'campaigns'
    AND COLUMN_NAME = 'category'
);

SET @category_needs_repair = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'campaigns'
    AND COLUMN_NAME = 'category'
    AND (
      DATA_TYPE = 'enum'
      OR CHARACTER_MAXIMUM_LENGTH IS NULL
      OR CHARACTER_MAXIMUM_LENGTH < 255
      OR IS_NULLABLE = 'YES'
    )
);

SET @category_sql = IF(
  @category_column_exists = 0,
  'ALTER TABLE `campaigns` ADD COLUMN `category` VARCHAR(255) NOT NULL DEFAULT ''All Categories''',
  IF(
    @category_needs_repair > 0,
    'ALTER TABLE `campaigns` MODIFY COLUMN `category` VARCHAR(255) NOT NULL DEFAULT ''All Categories''',
    'SELECT 1'
  )
);
PREPARE category_stmt FROM @category_sql; EXECUTE category_stmt; DEALLOCATE PREPARE category_stmt;

UPDATE `campaigns`
SET `category` = 'All Categories'
WHERE `category` IS NULL OR TRIM(`category`) = '';
