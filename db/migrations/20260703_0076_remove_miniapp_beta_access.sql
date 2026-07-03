-- Mini Apps are generally available; the legacy per-user beta gate is obsolete.
SET @has_miniapp_beta_access := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'miniapp_beta_access'
);

SET @drop_miniapp_beta_access := IF(
  @has_miniapp_beta_access > 0,
  'ALTER TABLE users DROP COLUMN miniapp_beta_access',
  'SELECT 1'
);

PREPARE remove_miniapp_beta_access FROM @drop_miniapp_beta_access;
EXECUTE remove_miniapp_beta_access;
DEALLOCATE PREPARE remove_miniapp_beta_access;
