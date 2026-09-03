-- Versioned Mini App publisher CPM v2. Additive only; no historical backfill.

ALTER TABLE miniapp_internal_ad_impressions
  ADD COLUMN IF NOT EXISTS economic_value DECIMAL(24,12) NOT NULL DEFAULT 0 AFTER advertiser_debit,
  ADD COLUMN IF NOT EXISTS publisher_cap DECIMAL(24,12) NOT NULL DEFAULT 0 AFTER economic_value,
  ADD COLUMN IF NOT EXISTS formula_version VARCHAR(64) NULL AFTER publisher_cap,
  ADD COLUMN IF NOT EXISTS geo_source VARCHAR(64) NOT NULL DEFAULT 'unknown' AFTER formula_version,
  ADD COLUMN IF NOT EXISTS geo_factor DECIMAL(12,10) NOT NULL DEFAULT 0 AFTER geo_source,
  ADD COLUMN IF NOT EXISTS demand_yield_factor DECIMAL(12,10) NOT NULL DEFAULT 0 AFTER geo_factor,
  ADD COLUMN IF NOT EXISTS uniqueness_factor DECIMAL(12,10) NOT NULL DEFAULT 0 AFTER demand_yield_factor,
  ADD COLUMN IF NOT EXISTS frequency_factor DECIMAL(12,10) NOT NULL DEFAULT 0 AFTER uniqueness_factor,
  ADD COLUMN IF NOT EXISTS traffic_quality_factor DECIMAL(12,10) NOT NULL DEFAULT 0 AFTER frequency_factor,
  ADD COLUMN IF NOT EXISTS trust_factor DECIMAL(12,10) NOT NULL DEFAULT 0 AFTER traffic_quality_factor,
  ADD COLUMN IF NOT EXISTS fraud_factor DECIMAL(12,10) NOT NULL DEFAULT 0 AFTER trust_factor,
  ADD COLUMN IF NOT EXISTS session_hash CHAR(64) NULL AFTER fraud_factor,
  ADD COLUMN IF NOT EXISTS device_hash CHAR(64) NULL AFTER session_hash,
  ADD COLUMN IF NOT EXISTS network_hash CHAR(64) NULL AFTER device_hash;

CREATE INDEX IF NOT EXISTS idx_miniapp_internal_frequency_v2
  ON miniapp_internal_ad_impressions (miniapp_id, campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_miniapp_internal_device_v2
  ON miniapp_internal_ad_impressions (device_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_miniapp_internal_session_v2
  ON miniapp_internal_ad_impressions (session_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_miniapp_internal_network_v2
  ON miniapp_internal_ad_impressions (network_hash, created_at);

ALTER TABLE miniapp_rewarded_campaigns
  ADD COLUMN IF NOT EXISTS fixed_cpm_override_reason VARCHAR(500) NULL AFTER fixed_publisher_cpm,
  ADD COLUMN IF NOT EXISTS fixed_cpm_override_expires_at DATETIME NULL AFTER fixed_cpm_override_reason;

INSERT INTO settings (`key`,value,description) VALUES
  ('miniapp_publisher_cpm_v2_formula_version','miniapp_publisher_cpm_v2','Formula applied only to new Mini App publisher economics'),
  ('miniapp_publisher_cpm_v2_max_share','0.50','Maximum publisher share of verified economic value'),
  ('miniapp_publisher_cpm_v2_absolute_cpm_cap','11.00','Absolute publisher CPM ceiling in USD'),
  ('miniapp_publisher_cpm_v2_reserve_share','0.10','Reserve share of economic value'),
  ('miniapp_publisher_cpm_v2_required_margin_share','0.10','Minimum retained platform share protected by the envelope'),
  ('miniapp_publisher_cpm_v2_geo_unknown_factor','0.45','Fallback for unknown or unconfigured ISO country'),
  ('miniapp_publisher_cpm_v2_geo_factor_min','0.25','Minimum configurable GEO value factor'),
  ('miniapp_publisher_cpm_v2_geo_factor_max','1.00','Maximum configurable GEO value factor'),
  ('miniapp_publisher_cpm_v2_geo_multipliers','{"US":1,"CA":1,"GB":1,"AU":1,"DE":1,"FR":1,"IN":0.68,"BR":0.68,"MX":0.68,"NG":0.52,"ID":0.52,"PH":0.52,"PK":0.4,"BD":0.4,"ET":0.4}','Editable ISO country overrides; every other valid ISO code uses the explicit unknown fallback'),
  ('miniapp_publisher_cpm_v2_frequency_decay_rate','0.16','Continuous rolling repeat decay rate'),
  ('miniapp_publisher_cpm_v2_frequency_zero_after','120','Seven-day matching-identity count that forces zero publisher payout'),
  ('miniapp_publisher_cpm_v2_quality_factor_min','0','No positive publisher quality floor'),
  ('miniapp_publisher_cpm_v2_quality_factor_max','1','Maximum measured quality factor'),
  ('miniapp_publisher_cpm_v2_trust_factor_min','0.10','Minimum non-fraud trust factor'),
  ('miniapp_publisher_cpm_v2_trust_factor_max','1','Maximum trust factor'),
  ('miniapp_publisher_cpm_v2_fraud_factor_min','0','Confirmed/high-risk traffic may earn zero'),
  ('miniapp_publisher_cpm_v2_fraud_factor_max','1','Maximum fraud-risk factor')
ON DUPLICATE KEY UPDATE value=value,description=VALUES(description);

INSERT INTO settings (`key`,value,description)
VALUES ('miniapp_publisher_cpm_v2_activated_at', DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:%i:%s'), 'UTC activation boundary; historical external settlements retain legacy payout semantics')
ON DUPLICATE KEY UPDATE value=value,description=VALUES(description);
