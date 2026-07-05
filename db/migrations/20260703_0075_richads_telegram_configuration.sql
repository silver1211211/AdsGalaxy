SET @richads_columns = CONCAT(
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='miniapp_ad_networks' AND COLUMN_NAME='richads_publisher_id'), '', 'ADD COLUMN richads_publisher_id VARCHAR(255) NULL AFTER network_placement_id,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='miniapp_ad_networks' AND COLUMN_NAME='richads_app_id'), '', 'ADD COLUMN richads_app_id VARCHAR(255) NULL AFTER richads_publisher_id,')
);
SET @richads_columns_sql = IF(@richads_columns='', 'SELECT 1', CONCAT('ALTER TABLE miniapp_ad_networks ', TRIM(TRAILING ',' FROM @richads_columns)));
PREPARE richads_columns_stmt FROM @richads_columns_sql; EXECUTE richads_columns_stmt; DEALLOCATE PREPARE richads_columns_stmt;

UPDATE miniapp_ad_networks
SET richads_app_id = COALESCE(richads_app_id, network_placement_id)
WHERE network_name = 'RichAds' AND network_placement_id IS NOT NULL;

UPDATE miniapp_ad_networks
SET enabled = FALSE
WHERE network_name = 'RichAds'
  AND (NULLIF(TRIM(richads_publisher_id), '') IS NULL OR NULLIF(TRIM(richads_app_id), '') IS NULL);
