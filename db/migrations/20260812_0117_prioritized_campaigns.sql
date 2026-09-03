ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS is_prioritized TINYINT(1) NOT NULL DEFAULT 0 AFTER status,
  ADD INDEX IF NOT EXISTS idx_campaigns_prioritized_active (is_prioritized, status, created_at);
