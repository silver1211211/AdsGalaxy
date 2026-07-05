UPDATE bot_users
SET status = 'pending_verification', is_active = FALSE, inactive_reason = NULL
WHERE COALESCE(source, 'legacy') <> 'integration'
  AND last_successful_delivery_at IS NULL
  AND is_active = TRUE
  AND status = 'active';

SET @broadcast_candidates_index_sql = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bot_users' AND INDEX_NAME='idx_bot_users_broadcast_candidates'),
  'SELECT 1',
  'CREATE INDEX idx_bot_users_broadcast_candidates ON bot_users (bot_id, is_active, status, last_broadcast_at)'
);
PREPARE broadcast_candidates_index_stmt FROM @broadcast_candidates_index_sql; EXECUTE broadcast_candidates_index_stmt; DEALLOCATE PREPARE broadcast_candidates_index_stmt;

SET @source_status_index_sql = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bot_users' AND INDEX_NAME='idx_bot_users_source_status'),
  'SELECT 1',
  'CREATE INDEX idx_bot_users_source_status ON bot_users (bot_id, source, status)'
);
PREPARE source_status_index_stmt FROM @source_status_index_sql; EXECUTE source_status_index_stmt; DEALLOCATE PREPARE source_status_index_stmt;
