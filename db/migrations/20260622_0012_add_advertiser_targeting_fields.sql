-- Phase 6: advertiser targeting fields.
-- Additive only. Existing campaigns keep broad targeting defaults.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS countries JSON NULL AFTER continents,
  ADD COLUMN IF NOT EXISTS languages JSON NULL AFTER countries,
  ADD COLUMN IF NOT EXISTS vpn_policy VARCHAR(30) NOT NULL DEFAULT 'allow_all' AFTER languages,
  ADD COLUMN IF NOT EXISTS device_policy VARCHAR(30) NOT NULL DEFAULT 'all' AFTER vpn_policy,
  ADD COLUMN IF NOT EXISTS os_policy VARCHAR(30) NOT NULL DEFAULT 'all' AFTER device_policy,
  ADD COLUMN IF NOT EXISTS start_at DATETIME NULL AFTER os_policy,
  ADD COLUMN IF NOT EXISTS end_at DATETIME NULL AFTER start_at,
  ADD COLUMN IF NOT EXISTS daily_budget_limit DECIMAL(18,8) NULL AFTER end_at,
  ADD COLUMN IF NOT EXISTS frequency_cap_per_user INT NULL AFTER daily_budget_limit;

ALTER TABLE miniapp_rewarded_campaigns
  ADD COLUMN IF NOT EXISTS countries JSON NULL AFTER target_countries,
  ADD COLUMN IF NOT EXISTS languages JSON NULL AFTER countries,
  ADD COLUMN IF NOT EXISTS vpn_policy VARCHAR(30) NOT NULL DEFAULT 'allow_all' AFTER languages,
  ADD COLUMN IF NOT EXISTS device_policy VARCHAR(30) NOT NULL DEFAULT 'all' AFTER vpn_policy,
  ADD COLUMN IF NOT EXISTS os_policy VARCHAR(30) NOT NULL DEFAULT 'all' AFTER device_policy,
  ADD COLUMN IF NOT EXISTS start_at DATETIME NULL AFTER os_policy,
  ADD COLUMN IF NOT EXISTS end_at DATETIME NULL AFTER start_at,
  ADD COLUMN IF NOT EXISTS daily_budget_limit DECIMAL(18,8) NULL AFTER end_at,
  ADD COLUMN IF NOT EXISTS frequency_cap_per_user INT NULL AFTER daily_budget_limit;

CREATE INDEX IF NOT EXISTS idx_campaigns_targeting_schedule
  ON campaigns (status, start_at, end_at);

CREATE INDEX IF NOT EXISTS idx_miniapp_rewarded_targeting_schedule
  ON miniapp_rewarded_campaigns (status, start_at, end_at);
