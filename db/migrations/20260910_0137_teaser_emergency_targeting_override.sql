-- Additive, deployment-time schema only; no production data backfill.
ALTER TABLE teaser_emergency_jobs
  ADD COLUMN override_targeting TINYINT(1) NOT NULL DEFAULT 0 AFTER idempotency_key,
  ADD KEY idx_teaser_emergency_override_status (override_targeting, status);
