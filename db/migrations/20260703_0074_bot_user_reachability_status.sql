UPDATE bot_users
SET status = 'pending_verification', is_active = TRUE, inactive_reason = NULL
WHERE COALESCE(source, 'legacy') <> 'integration'
  AND last_successful_delivery_at IS NULL
  AND is_active = TRUE
  AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_bot_users_broadcast_candidates
  ON bot_users (bot_id, is_active, status, last_broadcast_at);

CREATE INDEX IF NOT EXISTS idx_bot_users_source_status
  ON bot_users (bot_id, source, status);
