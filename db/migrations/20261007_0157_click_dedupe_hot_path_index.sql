-- Add only after 0156 is reviewed/applied. DO NOT apply from this source-only task.
-- EXPLAIN/index audit found individual campaign_clicks post_id/fingerprint indexes,
-- but no composite index for the redirect dedupe predicate.
ALTER TABLE campaign_clicks
  ADD KEY IF NOT EXISTS idx_campaign_clicks_post_fingerprint_created (post_id, fingerprint, created_at);
