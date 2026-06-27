-- Suspicious revenue per-record admin review workflow.

ALTER TABLE miniapp_daily_stats
  ADD COLUMN IF NOT EXISTS revenue_review_note VARCHAR(255) NULL AFTER revenue_reviewed_by,
  ADD KEY IF NOT EXISTS idx_miniapp_daily_stats_reviewed_by (revenue_reviewed_by, revenue_reviewed_at);
