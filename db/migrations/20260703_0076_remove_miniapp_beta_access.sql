-- Mini Apps are generally available; the legacy per-user beta gate is obsolete.
-- Production safety: do not drop the legacy column or delete its historical data.
-- Keeping the unused column is harmless and makes this migration non-destructive.
SET @has_miniapp_beta_access := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'miniapp_beta_access'
);

SELECT
  'miniapp_beta_access retained' AS action,
  @has_miniapp_beta_access AS column_present;
