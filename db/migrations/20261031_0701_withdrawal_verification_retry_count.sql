-- Preserve existing verification tasks while adding the worker's retry counter.
-- Separate migration: prior 0700 may already be recorded with its original checksum.
ALTER TABLE `withdrawal_verification_tasks`
  ADD COLUMN IF NOT EXISTS `retry_count` INT NOT NULL DEFAULT 0;

-- A task can be claimed again only after its lease expires. This index keeps
-- recovery and the queue's oldest-task lookup bounded as history grows.
CREATE INDEX IF NOT EXISTS `idx_status_lease`
  ON `withdrawal_verification_tasks` (`status`, `lease_expires_at`);
