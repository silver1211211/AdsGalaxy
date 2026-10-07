-- Mini App daily-cap lifecycle and deterministic external-delivery batches.
-- Additive/idempotent. Times and billing dates are UTC in application queries.

ALTER TABLE miniapp_rewarded_campaigns
  ADD COLUMN IF NOT EXISTS daily_cap_reached_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS daily_cap_billing_date DATE NULL,
  ADD COLUMN IF NOT EXISTS daily_cap_cycle INT UNSIGNED NOT NULL DEFAULT 0;

ALTER TABLE miniapp_external_delivery_syncs
  ADD COLUMN IF NOT EXISTS next_batch_sequence BIGINT UNSIGNED NOT NULL DEFAULT 1;

ALTER TABLE miniapp_external_delivery_batches
  ADD COLUMN IF NOT EXISTS batch_sequence BIGINT UNSIGNED NULL;

CREATE TEMPORARY TABLE tmp_miniapp_external_batch_sequence AS
SELECT id, ROW_NUMBER() OVER (PARTITION BY sync_id ORDER BY id) AS batch_sequence
FROM miniapp_external_delivery_batches;

UPDATE miniapp_external_delivery_batches b
JOIN tmp_miniapp_external_batch_sequence seq ON seq.id = b.id
SET b.batch_sequence = seq.batch_sequence
WHERE b.batch_sequence IS NULL;

DROP TEMPORARY TABLE tmp_miniapp_external_batch_sequence;

UPDATE miniapp_external_delivery_syncs s
SET next_batch_sequence = COALESCE((
  SELECT MAX(b.batch_sequence) + 1
  FROM miniapp_external_delivery_batches b
  WHERE b.sync_id = s.id
), 1);

ALTER TABLE miniapp_external_delivery_batches
  MODIFY COLUMN batch_sequence BIGINT UNSIGNED NOT NULL,
  ADD UNIQUE KEY IF NOT EXISTS uq_miniapp_external_sync_batch (sync_id, batch_sequence);

