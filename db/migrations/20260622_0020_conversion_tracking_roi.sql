-- Phase 9: conversion tracking, postbacks, and ROI analytics.
-- Additive only. Payouts, withdrawals, CPM, fraud, inventory ranking, and network integrations remain unchanged.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS postback_url TEXT NULL AFTER link;

ALTER TABLE miniapp_rewarded_campaigns
  ADD COLUMN IF NOT EXISTS postback_url TEXT NULL AFTER landing_url;

CREATE TABLE IF NOT EXISTS ad_click_attribution (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  click_id VARCHAR(80) NOT NULL,
  campaign_type VARCHAR(30) NOT NULL,
  campaign_id BIGINT UNSIGNED NOT NULL,
  advertiser_id BIGINT UNSIGNED NOT NULL,
  creative_id VARCHAR(120) NULL,
  category VARCHAR(120) NULL,
  inventory_type VARCHAR(30) NULL,
  inventory_id BIGINT UNSIGNED NULL,
  post_id BIGINT UNSIGNED NULL,
  miniapp_id BIGINT UNSIGNED NULL,
  bot_id BIGINT UNSIGNED NULL,
  request_id VARCHAR(100) NULL,
  ip_address VARCHAR(64) NULL,
  user_agent TEXT NULL,
  fingerprint VARCHAR(64) NULL,
  session_id VARCHAR(120) NULL,
  conversion_status VARCHAR(30) NOT NULL DEFAULT 'none',
  converted_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_ad_click_attribution_click_id (click_id),
  KEY idx_ad_click_campaign (campaign_type, campaign_id, created_at),
  KEY idx_ad_click_advertiser (advertiser_id, created_at),
  KEY idx_ad_click_inventory (inventory_type, inventory_id, created_at),
  KEY idx_ad_click_fingerprint (campaign_type, campaign_id, fingerprint, created_at)
);

CREATE TABLE IF NOT EXISTS ad_conversions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conversion_id VARCHAR(100) NOT NULL,
  click_id VARCHAR(80) NOT NULL,
  campaign_type VARCHAR(30) NOT NULL,
  campaign_id BIGINT UNSIGNED NOT NULL,
  advertiser_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  event_name VARCHAR(120) NULL,
  conversion_value DECIMAL(18,8) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  source VARCHAR(30) NOT NULL DEFAULT 'postback',
  payload JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_ad_conversions_conversion_id (conversion_id),
  UNIQUE KEY uniq_ad_conversions_click_event (click_id, event_type, event_name),
  KEY idx_ad_conversions_campaign (campaign_type, campaign_id, created_at),
  KEY idx_ad_conversions_advertiser (advertiser_id, created_at),
  KEY idx_ad_conversions_event (event_type, created_at)
);

CREATE TABLE IF NOT EXISTS conversion_review_queue (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  campaign_type VARCHAR(30) NOT NULL,
  campaign_id BIGINT UNSIGNED NOT NULL,
  advertiser_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(120) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  metadata JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_conversion_review_status (status, created_at),
  KEY idx_conversion_review_campaign (campaign_type, campaign_id)
);

INSERT INTO settings (`key`, value) VALUES
  ('conversion_attribution_window_days', '7')
ON DUPLICATE KEY UPDATE value = value;
