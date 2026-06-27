-- Phase 6A: dynamic publisher CPM for AdsGalaxy-owned Mini App inventory only.
-- Additive only. External network settlement remains unchanged.

ALTER TABLE miniapp_rewarded_campaigns
  ADD COLUMN IF NOT EXISTS advertiser_cpm_bid DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER remaining_budget,
  ADD COLUMN IF NOT EXISTS cpm_mode VARCHAR(20) NOT NULL DEFAULT 'live' AFTER admin_cpm,
  ADD COLUMN IF NOT EXISTS fixed_publisher_cpm DECIMAL(18,8) NULL AFTER cpm_mode,
  ADD COLUMN IF NOT EXISTS campaign_budget_mode VARCHAR(20) NOT NULL DEFAULT 'custom' AFTER fixed_publisher_cpm,
  ADD COLUMN IF NOT EXISTS daily_budget_mode VARCHAR(20) NOT NULL DEFAULT 'custom' AFTER campaign_budget_mode;

ALTER TABLE miniapp_internal_ad_impressions
  ADD COLUMN IF NOT EXISTS advertiser_cpm DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER country,
  ADD COLUMN IF NOT EXISTS publisher_cpm DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER cpm,
  ADD COLUMN IF NOT EXISTS publisher_revenue DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER cost,
  ADD COLUMN IF NOT EXISTS ads_galaxy_revenue DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER publisher_revenue,
  ADD COLUMN IF NOT EXISTS reserve_revenue DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER ads_galaxy_revenue,
  ADD COLUMN IF NOT EXISTS quality_factor DECIMAL(10,8) NULL AFTER reserve_revenue,
  ADD COLUMN IF NOT EXISTS repeat_penalty_factor DECIMAL(10,8) NULL AFTER quality_factor,
  ADD COLUMN IF NOT EXISTS quality_metadata JSON NULL AFTER repeat_penalty_factor,
  ADD COLUMN IF NOT EXISTS cpm_mode VARCHAR(20) NOT NULL DEFAULT 'live' AFTER quality_metadata;

ALTER TABLE miniapp_daily_stats
  ADD COLUMN IF NOT EXISTS reserve_revenue DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER ads_galaxy_fee;

INSERT INTO settings (`key`, value) VALUES
  ('miniapp_internal_min_cpm', '0.50'),
  ('miniapp_internal_recommended_cpm', '1.00'),
  ('miniapp_internal_max_cpm', '5.00'),
  ('miniapp_internal_publisher_share_percent', '60'),
  ('miniapp_internal_ads_galaxy_share_percent', '30'),
  ('miniapp_internal_reserve_percent', '10'),
  ('miniapp_internal_min_quality_factor', '0.10'),
  ('miniapp_internal_max_quality_factor', '0.90'),
  ('miniapp_internal_traffic_sensitivity', 'medium'),
  ('miniapp_internal_repeat_penalty_enabled', '1'),
  ('miniapp_internal_reserve_pool_enabled', '1')
ON DUPLICATE KEY UPDATE value = value;

UPDATE miniapp_rewarded_campaigns
SET advertiser_cpm_bid = admin_cpm
WHERE advertiser_cpm_bid = 0
  AND admin_cpm > 0;

CREATE INDEX IF NOT EXISTS idx_miniapp_internal_ad_user_campaign_day
  ON miniapp_internal_ad_impressions (campaign_id, telegram_user_id, created_at);
