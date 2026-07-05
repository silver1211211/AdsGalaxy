-- Prompt 3: Bot monetization integrity, shared reachability states, and broadcast failure diagnostics.
-- Additive only. Does not modify Mini App, Channel Ads, settlement, revenue reserve, CPM, or admin permissions.

SET @delivery_columns = CONCAT(
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='broadcast_deliveries' AND COLUMN_NAME='cost'), '', 'ADD COLUMN cost DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER chat_id,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='broadcast_deliveries' AND COLUMN_NAME='publisher_reward'), '', 'ADD COLUMN publisher_reward DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER cost,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='broadcast_deliveries' AND COLUMN_NAME='status'), '', 'ADD COLUMN status VARCHAR(24) NOT NULL DEFAULT ''sent'' AFTER publisher_reward,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='broadcast_deliveries' AND COLUMN_NAME='failure_reason'), '', 'ADD COLUMN failure_reason VARCHAR(255) NULL AFTER status,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='broadcast_deliveries' AND COLUMN_NAME='telegram_error'), '', 'ADD COLUMN telegram_error VARCHAR(500) NULL AFTER failure_reason,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='broadcast_deliveries' AND COLUMN_NAME='retry_count'), '', 'ADD COLUMN retry_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER telegram_error,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='broadcast_deliveries' AND COLUMN_NAME='last_success_at'), '', 'ADD COLUMN last_success_at DATETIME NULL AFTER retry_count,'),
  IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='broadcast_deliveries' AND COLUMN_NAME='last_failure_at'), '', 'ADD COLUMN last_failure_at DATETIME NULL AFTER last_success_at,')
);
SET @delivery_columns_sql = IF(@delivery_columns='', 'SELECT 1', CONCAT('ALTER TABLE broadcast_deliveries ', TRIM(TRAILING ',' FROM @delivery_columns)));
PREPARE delivery_columns_stmt FROM @delivery_columns_sql; EXECUTE delivery_columns_stmt; DEALLOCATE PREPARE delivery_columns_stmt;

SET @delivery_status_index_sql = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='broadcast_deliveries' AND INDEX_NAME='idx_broadcast_deliveries_status_time'),
  'SELECT 1',
  'CREATE INDEX idx_broadcast_deliveries_status_time ON broadcast_deliveries (status, created_at)'
);
PREPARE delivery_status_index_stmt FROM @delivery_status_index_sql; EXECUTE delivery_status_index_stmt; DEALLOCATE PREPARE delivery_status_index_stmt;

SET @delivery_failure_index_sql = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='broadcast_deliveries' AND INDEX_NAME='idx_broadcast_deliveries_failure'),
  'SELECT 1',
  'CREATE INDEX idx_broadcast_deliveries_failure ON broadcast_deliveries (bot_id, status, last_failure_at)'
);
PREPARE delivery_failure_index_stmt FROM @delivery_failure_index_sql; EXECUTE delivery_failure_index_stmt; DEALLOCATE PREPARE delivery_failure_index_stmt;

UPDATE bot_users
SET status = 'pending_verification',
    is_active = FALSE,
    inactive_reason = NULL
WHERE COALESCE(source, 'legacy') <> 'integration'
  AND integration_first_seen_at IS NULL
  AND last_successful_delivery_at IS NULL
  AND status = 'active';

UPDATE bot_users
SET status = 'active',
    is_active = TRUE,
    inactive_reason = NULL
WHERE COALESCE(source, 'legacy') = 'integration'
  AND status = 'pending_verification'
  AND integration_first_seen_at IS NOT NULL;

SET @verified_reachable_index_sql = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bot_users' AND INDEX_NAME='idx_bot_users_verified_reachable'),
  'SELECT 1',
  'CREATE INDEX idx_bot_users_verified_reachable ON bot_users (bot_id, status, is_active, chat_id)'
);
PREPARE verified_reachable_index_stmt FROM @verified_reachable_index_sql; EXECUTE verified_reachable_index_stmt; DEALLOCATE PREPARE verified_reachable_index_stmt;
