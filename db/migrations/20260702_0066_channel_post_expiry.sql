-- Retry-safe sponsored channel post expiry.
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='campaign_posts' AND COLUMN_NAME='delete_failed_at')=0,
  'ALTER TABLE campaign_posts ADD COLUMN delete_failed_at DATETIME NULL AFTER delete_failed_reason', 'SELECT 1');
PREPARE expiry_stmt FROM @ddl; EXECUTE expiry_stmt; DEALLOCATE PREPARE expiry_stmt;

SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='campaign_posts' AND INDEX_NAME='idx_campaign_posts_expiry')=0,
  'CREATE INDEX idx_campaign_posts_expiry ON campaign_posts(status,delivery_failed_at,deleted_at,delivery_confirmed_at,created_at)', 'SELECT 1');
PREPARE expiry_stmt FROM @ddl; EXECUTE expiry_stmt; DEALLOCATE PREPARE expiry_stmt;

INSERT INTO settings (`key`,value,description) VALUES
  ('channel_post_lifetime_hours','24','Sponsored channel post lifetime in hours before Telegram deletion')
ON DUPLICATE KEY UPDATE description=VALUES(description);
