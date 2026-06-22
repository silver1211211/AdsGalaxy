-- Phase 10: AdsGalaxy-owned Mini App rewarded ad campaigns and impressions.

CREATE TABLE IF NOT EXISTS miniapp_rewarded_campaigns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  advertiser_id INT NOT NULL,
  campaign_name VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT NULL,
  landing_url TEXT NOT NULL,
  budget DECIMAL(18,8) NOT NULL DEFAULT 0,
  remaining_budget DECIMAL(18,8) NOT NULL DEFAULT 0,
  admin_cpm DECIMAL(18,8) NOT NULL DEFAULT 0,
  target_countries VARCHAR(500) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_miniapp_rewarded_campaigns_status_budget (status, remaining_budget),
  KEY idx_miniapp_rewarded_campaigns_advertiser_created (advertiser_id, created_at),
  CONSTRAINT fk_miniapp_rewarded_campaigns_advertiser
    FOREIGN KEY (advertiser_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS miniapp_internal_ad_impressions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  telegram_user_id BIGINT NOT NULL,
  country VARCHAR(2) NULL,
  cpm DECIMAL(18,8) NOT NULL DEFAULT 0,
  cost DECIMAL(18,8) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_miniapp_internal_ad_request (request_id),
  KEY idx_miniapp_internal_ad_campaign_created (campaign_id, created_at),
  KEY idx_miniapp_internal_ad_miniapp_created (miniapp_id, created_at),
  CONSTRAINT fk_miniapp_internal_ad_impressions_campaign
    FOREIGN KEY (campaign_id) REFERENCES miniapp_rewarded_campaigns(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_miniapp_internal_ad_impressions_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE miniapp_mediation_requests
  ADD COLUMN internal_campaign_id BIGINT UNSIGNED NULL AFTER selected_network,
  ADD KEY idx_miniapp_mediation_internal_campaign (internal_campaign_id);

INSERT INTO settings (`key`, value)
VALUES ('internal_ads_max_share_percent', '20')
ON DUPLICATE KEY UPDATE value = value;
