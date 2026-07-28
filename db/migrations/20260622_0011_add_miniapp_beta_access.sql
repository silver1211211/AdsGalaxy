-- Mini App Monetization launch access flag.
-- Mini Apps are live for all accounts; the legacy flag remains for older admin/UI compatibility.

SET @migration_sql = IF(
  NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'miniapp_beta_access'
  ),
  'ALTER TABLE users ADD COLUMN miniapp_beta_access TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT 1'
);

PREPARE migration_stmt FROM @migration_sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

UPDATE users
SET miniapp_beta_access = 1
WHERE miniapp_beta_access <> 1;
