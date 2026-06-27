-- Phase 6B: advertiser trust and campaign quality controls.
-- Additive only. Does not change publisher earnings, settlements, withdrawals, or external networks.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS advertiser_trust_level VARCHAR(20) NOT NULL DEFAULT 'new' AFTER ad_balance,
  ADD COLUMN IF NOT EXISTS advertiser_trust_updated_at DATETIME NULL AFTER advertiser_trust_level,
  ADD COLUMN IF NOT EXISTS advertiser_trust_note VARCHAR(255) NULL AFTER advertiser_trust_updated_at;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS quality_score INT NOT NULL DEFAULT 50 AFTER category,
  ADD COLUMN IF NOT EXISTS quality_tier VARCHAR(20) NOT NULL DEFAULT 'average' AFTER quality_score,
  ADD COLUMN IF NOT EXISTS quality_metadata JSON NULL AFTER quality_tier;

ALTER TABLE miniapp_rewarded_campaigns
  ADD COLUMN IF NOT EXISTS quality_score INT NOT NULL DEFAULT 50 AFTER title,
  ADD COLUMN IF NOT EXISTS quality_tier VARCHAR(20) NOT NULL DEFAULT 'average' AFTER quality_score,
  ADD COLUMN IF NOT EXISTS quality_metadata JSON NULL AFTER quality_tier;

INSERT INTO settings (`key`, value) VALUES
  ('advertiser_trust_multiplier_new', '0.75'),
  ('advertiser_trust_multiplier_normal', '1.00'),
  ('advertiser_trust_multiplier_trusted', '1.15'),
  ('advertiser_trust_multiplier_premium', '1.35'),
  ('advertiser_trust_multiplier_restricted', '0.20')
ON DUPLICATE KEY UPDATE value = value;

CREATE INDEX IF NOT EXISTS idx_users_advertiser_trust
  ON users (advertiser_trust_level);

CREATE INDEX IF NOT EXISTS idx_campaigns_quality
  ON campaigns (quality_score, quality_tier);

CREATE INDEX IF NOT EXISTS idx_miniapp_rewarded_quality
  ON miniapp_rewarded_campaigns (quality_score, quality_tier);
