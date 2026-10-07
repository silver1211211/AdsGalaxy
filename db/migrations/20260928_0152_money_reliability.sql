-- Additive-only Prompt 11 schema. Deployment tooling applies this later.
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS local_canceled_at DATETIME NULL AFTER status,
  ADD COLUMN IF NOT EXISTS provider_status VARCHAR(32) NULL AFTER local_canceled_at,
  ADD COLUMN IF NOT EXISTS creation_idempotency_key CHAR(64) NULL AFTER provider_status,
  ADD COLUMN IF NOT EXISTS creation_request_fingerprint CHAR(64) NULL AFTER creation_idempotency_key,
  ADD COLUMN IF NOT EXISTS creation_state VARCHAR(24) NULL AFTER creation_request_fingerprint;
SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='deposits' AND index_name='uq_deposit_creation_key');
SET @sql := IF(@exists=0,'CREATE UNIQUE INDEX uq_deposit_creation_key ON deposits(user_id, creation_idempotency_key)','SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='deposits' AND index_name='idx_deposit_reconcile');
SET @sql := IF(@exists=0,'CREATE INDEX idx_deposit_reconcile ON deposits(provider_status, status, created_at)','SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS idempotency_key CHAR(64) NULL AFTER address,
  ADD COLUMN IF NOT EXISTS request_fingerprint CHAR(64) NULL AFTER idempotency_key;
SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='withdrawals' AND index_name='uq_withdrawal_idempotency');
SET @sql := IF(@exists=0,'CREATE UNIQUE INDEX uq_withdrawal_idempotency ON withdrawals(user_id, idempotency_key)','SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
