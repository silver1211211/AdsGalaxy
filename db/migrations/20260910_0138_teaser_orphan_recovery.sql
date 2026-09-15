-- Additive operation leases for crash-safe Teaser insert/remove reconciliation.
ALTER TABLE teaser_placements
  MODIFY COLUMN status ENUM('claimed','inserting','awaiting_baseline','active','removal_pending','removing','removed','already_absent','failed') NOT NULL DEFAULT 'claimed',
  ADD COLUMN IF NOT EXISTS operation_kind ENUM('insert','remove') NULL AFTER status,
  ADD COLUMN IF NOT EXISTS operation_started_at DATETIME NULL AFTER operation_kind,
  ADD COLUMN IF NOT EXISTS operation_lease_expires_at DATETIME NULL AFTER operation_started_at,
  ADD COLUMN IF NOT EXISTS last_error_category VARCHAR(64) NULL AFTER last_error_code,
  ADD KEY IF NOT EXISTS idx_teaser_operation_lease (status,operation_lease_expires_at,id);

ALTER TABLE teaser_emergency_job_channels
  ADD COLUMN IF NOT EXISTS lease_until DATETIME NULL AFTER next_retry_at,
  ADD KEY IF NOT EXISTS idx_teaser_emergency_processing_lease (status,lease_until,id);
