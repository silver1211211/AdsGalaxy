-- Phase 1 evidence-based dashboard/list indexes.
-- EXPLAIN showed a 70k-row users scan for date-range counts and a filesort for
-- the advertiser's newest campaigns. This file is intentionally not applied.
ALTER TABLE users
  ADD INDEX IF NOT EXISTS idx_users_created_at (created_at);

ALTER TABLE campaigns
  ADD INDEX IF NOT EXISTS idx_campaigns_user_created (user_id, created_at, id);
