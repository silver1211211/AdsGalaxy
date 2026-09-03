-- Align the smaller click-attribution join key with the canonical Mini App
-- mediation request collation. This preserves both existing indexed joins.

SET @request_id_collation = (
  SELECT COLLATION_NAME
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ad_click_attribution'
    AND COLUMN_NAME = 'request_id'
);

SET @sql = IF(
  @request_id_collation <> 'utf8mb4_unicode_ci',
  'ALTER TABLE ad_click_attribution MODIFY COLUMN request_id VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL, ALGORITHM=COPY, LOCK=SHARED',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
