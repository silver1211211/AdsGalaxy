-- Durable Telegram delivery/recall metadata. No financial values are changed.
ALTER TABLE broadcast_deliveries
  ADD COLUMN IF NOT EXISTS telegram_message_id BIGINT NULL AFTER telegram_error,
  ADD COLUMN IF NOT EXISTS next_retry_at DATETIME NULL AFTER retry_count,
  ADD COLUMN IF NOT EXISTS failure_category VARCHAR(32) NULL AFTER failure_reason,
  ADD COLUMN IF NOT EXISTS sending_at DATETIME NULL AFTER next_retry_at,
  ADD COLUMN IF NOT EXISTS lease_expires_at DATETIME NULL AFTER sending_at;

CREATE INDEX IF NOT EXISTS idx_broadcast_deliveries_retry
  ON broadcast_deliveries (status, next_retry_at, id);
CREATE INDEX IF NOT EXISTS idx_broadcast_deliveries_user_success
  ON broadcast_deliveries (user_id, status, created_at);

ALTER TABLE platform_broadcast_recipients
  ADD COLUMN IF NOT EXISTS deletion_status VARCHAR(24) NULL AFTER telegram_message_id,
  ADD COLUMN IF NOT EXISTS deletion_attempts INT NOT NULL DEFAULT 0 AFTER deletion_status,
  ADD COLUMN IF NOT EXISTS deletion_next_retry_at DATETIME NULL AFTER deletion_attempts,
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL AFTER deletion_next_retry_at,
  ADD COLUMN IF NOT EXISTS deletion_error VARCHAR(500) NULL AFTER deleted_at;

CREATE INDEX IF NOT EXISTS idx_platform_recipient_deletion
  ON platform_broadcast_recipients (broadcast_id, deletion_status, deletion_next_retry_at, id);
