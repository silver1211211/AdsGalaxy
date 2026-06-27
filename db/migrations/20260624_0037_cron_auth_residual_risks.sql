-- Critical Fix Sprint #2: explicit cron auth coverage, pending delivery recovery, suspicious revenue review controls.

ALTER TABLE miniapp_daily_stats
  ADD COLUMN IF NOT EXISTS revenue_review_status VARCHAR(30) NOT NULL DEFAULT 'not_required' AFTER revenue_validated_at,
  ADD COLUMN IF NOT EXISTS revenue_reviewed_at DATETIME NULL AFTER revenue_review_status,
  ADD COLUMN IF NOT EXISTS revenue_reviewed_by INT NULL AFTER revenue_reviewed_at,
  ADD COLUMN IF NOT EXISTS revenue_review_notes VARCHAR(255) NULL AFTER revenue_reviewed_by,
  ADD KEY IF NOT EXISTS idx_miniapp_daily_stats_revenue_review (revenue_validation_status, revenue_review_status, date);

UPDATE miniapp_daily_stats
SET revenue_review_status = 'pending_review'
WHERE revenue_validation_status = 'suspicious'
  AND revenue_review_status = 'not_required';

INSERT INTO revenue_protection_settings (`key`, value, description) VALUES
  ('suspicious_revenue_settlement_behavior', 'review', 'Suspicious Mini App revenue settlement behavior: allow, review, or block')
ON DUPLICATE KEY UPDATE value = value;
