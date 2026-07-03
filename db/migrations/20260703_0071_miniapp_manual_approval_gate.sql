-- Mini App inventory approval is an explicit admin decision, independent of network configuration.
SET @has_admin_approved_at = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapps' AND COLUMN_NAME = 'admin_approved_at'
);
SET @sql = IF(@has_admin_approved_at = 0,
  'ALTER TABLE miniapps ADD COLUMN admin_approved_at DATETIME NULL AFTER status',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_admin_approved_by = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapps' AND COLUMN_NAME = 'admin_approved_by'
);
SET @sql = IF(@has_admin_approved_by = 0,
  'ALTER TABLE miniapps ADD COLUMN admin_approved_by INT NULL AFTER admin_approved_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Preserve the approval history of Mini Apps that were already live before this gate.
UPDATE miniapps
SET admin_approved_at = COALESCE(admin_approved_at, updated_at, created_at)
WHERE status IN ('approved', 'monetized');
