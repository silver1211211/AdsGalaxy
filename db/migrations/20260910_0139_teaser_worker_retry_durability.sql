-- Additive durable retry state for view/baseline processing and Emergency rows.
ALTER TABLE teaser_placements
  ADD COLUMN IF NOT EXISTS processing_attempts INT UNSIGNED NOT NULL DEFAULT 0 AFTER insertion_attempts,
  ADD COLUMN IF NOT EXISTS processing_next_retry_at DATETIME NULL AFTER insertion_next_retry_at,
  ADD KEY IF NOT EXISTS idx_teaser_processing_retry (status,processing_next_retry_at,id);

ALTER TABLE teaser_emergency_job_channels
  ADD COLUMN IF NOT EXISTS last_error_category VARCHAR(64) NULL AFTER reason_code;
