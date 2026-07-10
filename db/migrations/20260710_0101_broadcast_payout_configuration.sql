-- Bot/Broadcast payout configuration and per-delivery reconciliation fields.
-- Additive and idempotent: existing delivery and financial records are unchanged.
INSERT INTO settings (`key`, value, description) VALUES
  ('broadcast_publisher_share_percent', '30', 'Percent of each successful Bot broadcast debit allocated to the publisher'),
  ('broadcast_reserve_percent', '10', 'Percent of each successful Bot broadcast debit allocated to reserve')
ON DUPLICATE KEY UPDATE `key` = VALUES(`key`);

SET @broadcast_payout_columns = CONCAT(
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='broadcast_deliveries' AND COLUMN_NAME='reserve_amount'), '', 'ADD COLUMN reserve_amount DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER publisher_reward,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='broadcast_deliveries' AND COLUMN_NAME='platform_revenue'), '', 'ADD COLUMN platform_revenue DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER reserve_amount,')
);
SET @broadcast_payout_sql = IF(@broadcast_payout_columns = '', 'SELECT 1', CONCAT('ALTER TABLE broadcast_deliveries ', TRIM(TRAILING ',' FROM @broadcast_payout_columns)));
PREPARE broadcast_payout_stmt FROM @broadcast_payout_sql;
EXECUTE broadcast_payout_stmt;
DEALLOCATE PREPARE broadcast_payout_stmt;
