-- AdsGalaxy production hardening: distinguish scheduled posts from emergency sends.
-- Additive only. Existing rows default to scheduled so older reporting keeps working.

ALTER TABLE campaign_posts
  ADD COLUMN IF NOT EXISTS posting_mode VARCHAR(30) NOT NULL DEFAULT 'scheduled' AFTER status;

CREATE INDEX IF NOT EXISTS idx_campaign_posts_posting_mode_slot
  ON campaign_posts (posting_mode, channel_id, posting_slot_date, posting_slot_time);
