-- Record explicit /start interaction with the official AdsGalaxy bot.
-- Required before deploying the platform-broadcast reachability filter.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS official_bot_started_at DATETIME NULL AFTER last_active_at,
  ADD INDEX IF NOT EXISTS idx_users_official_bot_started (official_bot_started_at);
