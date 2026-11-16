-- Batch 3: Telegram channel identity reconciliation, migration tracking, and status ownership columns
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS paused_by_actor VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS admin_paused_at DATETIME(6) NULL,
  ADD COLUMN IF NOT EXISTS publisher_paused_at DATETIME(6) NULL;

ALTER TABLE channel_telegram_identities
  ADD COLUMN IF NOT EXISTS migrated_from_chat_id VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS last_migrated_at DATETIME(6) NULL,
  ADD COLUMN IF NOT EXISTS identity_conflict_chat_id VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS identity_conflict_channel_id INT NULL,
  ADD COLUMN IF NOT EXISTS identity_conflict_reason VARCHAR(255) NULL;

CREATE TABLE IF NOT EXISTS channel_identity_reconciliations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  channel_id INT NOT NULL,
  previous_chat_id VARCHAR(64) NULL,
  resolved_chat_id VARCHAR(64) NULL,
  previous_username VARCHAR(191) NULL,
  resolved_username VARCHAR(191) NULL,
  action VARCHAR(64) NOT NULL,
  outcome VARCHAR(64) NOT NULL,
  conflict_channel_id INT NULL,
  reason TEXT NULL,
  dry_run TINYINT(1) NOT NULL DEFAULT 1,
  worker_id VARCHAR(128) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_channel_identity_reconciliations_channel_created (channel_id, created_at),
  KEY idx_channel_identity_reconciliations_outcome_created (outcome, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
