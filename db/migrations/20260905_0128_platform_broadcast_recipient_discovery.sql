-- Support bounded recipient discovery without scanning the entire recipient table
-- for every eligible user. Safe to rerun on production.
ALTER TABLE platform_broadcast_recipients
  ADD INDEX IF NOT EXISTS idx_platform_recipient_user_status (user_id, status);
