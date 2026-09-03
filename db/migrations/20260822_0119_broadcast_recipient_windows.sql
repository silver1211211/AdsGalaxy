ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_active_at DATETIME NULL AFTER created_at,
  ADD INDEX IF NOT EXISTS idx_users_last_active_at (last_active_at);

ALTER TABLE platform_broadcasts
  ADD COLUMN IF NOT EXISTS target_value INT UNSIGNED NULL AFTER target_type,
  ADD COLUMN IF NOT EXISTS target_unit ENUM('seconds','minutes','hours') NULL AFTER target_value,
  ADD COLUMN IF NOT EXISTS target_since DATETIME NULL AFTER target_unit,
  ADD INDEX IF NOT EXISTS idx_platform_broadcast_target (target_type, target_since);
