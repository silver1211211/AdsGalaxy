-- Source only: intentionally NOT applied. Preserve observed NULL/default/collation semantics.
-- Never narrow a wider installation or truncate/rename historical labels.
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='campaign_posts' AND COLUMN_NAME='view_fetch_source'
    AND DATA_TYPE='varchar' AND CHARACTER_MAXIMUM_LENGTH<128)=1,
  'ALTER TABLE campaign_posts MODIFY COLUMN view_fetch_source VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
