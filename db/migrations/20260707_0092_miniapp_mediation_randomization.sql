-- Phase 9 Mini App mediation randomization diagnostics and per-app Monetag test mode.
-- Idempotent and non-destructive: adds defaulted/nullable columns only.

SET @has_monetag_test_mode := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'miniapp_ad_networks'
    AND COLUMN_NAME = 'monetag_test_mode'
);

SET @sql := IF(
  @has_monetag_test_mode = 0,
  'ALTER TABLE miniapp_ad_networks ADD COLUMN monetag_test_mode TINYINT(1) NOT NULL DEFAULT 0 AFTER enabled',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_mediation_diagnostics := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'miniapp_mediation_requests'
    AND COLUMN_NAME = 'mediation_diagnostics'
);

SET @sql := IF(
  @has_mediation_diagnostics = 0,
  'ALTER TABLE miniapp_mediation_requests ADD COLUMN mediation_diagnostics JSON NULL AFTER final_result',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
