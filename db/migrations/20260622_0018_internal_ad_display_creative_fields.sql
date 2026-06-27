-- Follow-up: AdsGalaxy internal ad display creative fields.
-- Additive only. Delivery, billing, settlement, and reward logic remain unchanged.

ALTER TABLE miniapp_rewarded_campaigns
  ADD COLUMN IF NOT EXISTS cta_text VARCHAR(60) NOT NULL DEFAULT 'Learn More' AFTER description,
  ADD COLUMN IF NOT EXISTS title_color VARCHAR(20) NULL AFTER cta_text,
  ADD COLUMN IF NOT EXISTS body_color VARCHAR(20) NULL AFTER title_color;
