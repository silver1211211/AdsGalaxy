-- Phase 15: Enterprise deals, premium inventory, reserved placements, and sponsorship packages.
-- Additive only. Does not modify payout, withdrawal, referral sprint, public SDK,
-- channel scheduler, bot broadcast architecture, or Mini App network adapters.

ALTER TABLE miniapps
  ADD COLUMN IF NOT EXISTS enterprise_inventory_tier VARCHAR(20) NOT NULL DEFAULT 'standard' AFTER marketplace_avg_completion_rate,
  ADD COLUMN IF NOT EXISTS enterprise_priority_score INT NOT NULL DEFAULT 0 AFTER enterprise_inventory_tier,
  ADD COLUMN IF NOT EXISTS enterprise_sponsorship_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER enterprise_priority_score;

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS enterprise_inventory_tier VARCHAR(20) NOT NULL DEFAULT 'standard' AFTER marketplace_avg_completion_rate,
  ADD COLUMN IF NOT EXISTS enterprise_priority_score INT NOT NULL DEFAULT 0 AFTER enterprise_inventory_tier,
  ADD COLUMN IF NOT EXISTS enterprise_sponsorship_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER enterprise_priority_score;

ALTER TABLE bots
  ADD COLUMN IF NOT EXISTS enterprise_inventory_tier VARCHAR(20) NOT NULL DEFAULT 'standard' AFTER marketplace_avg_completion_rate,
  ADD COLUMN IF NOT EXISTS enterprise_priority_score INT NOT NULL DEFAULT 0 AFTER enterprise_inventory_tier,
  ADD COLUMN IF NOT EXISTS enterprise_sponsorship_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER enterprise_priority_score;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS enterprise_priority_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER direct_inventory_metadata,
  ADD COLUMN IF NOT EXISTS enterprise_deal_id BIGINT UNSIGNED NULL AFTER enterprise_priority_enabled;

ALTER TABLE miniapp_rewarded_campaigns
  ADD COLUMN IF NOT EXISTS enterprise_priority_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER direct_inventory_metadata,
  ADD COLUMN IF NOT EXISTS enterprise_deal_id BIGINT UNSIGNED NULL AFTER enterprise_priority_enabled;

CREATE TABLE IF NOT EXISTS sponsorship_packages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(140) NOT NULL,
  description TEXT NULL,
  miniapp_impressions BIGINT NOT NULL DEFAULT 0,
  channel_posts INT NOT NULL DEFAULT 0,
  bot_broadcasts INT NOT NULL DEFAULT 0,
  featured_marketplace_days INT NOT NULL DEFAULT 0,
  priority_support TINYINT(1) NOT NULL DEFAULT 0,
  estimated_reach BIGINT NOT NULL DEFAULT 0,
  estimated_cpm DECIMAL(10,4) NOT NULL DEFAULT 0,
  package_price DECIMAL(14,4) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  requires_admin_approval TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_sponsorship_package_slug (slug),
  KEY idx_sponsorship_packages_status (status, package_price)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS enterprise_direct_deals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  advertiser_id INT NOT NULL,
  campaign_type VARCHAR(20) NOT NULL DEFAULT 'campaign',
  campaign_id BIGINT UNSIGNED NULL,
  package_id BIGINT UNSIGNED NULL,
  inventory_type VARCHAR(20) NOT NULL DEFAULT 'mixed',
  selected_inventory JSON NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  fixed_cpm DECIMAL(10,4) NOT NULL DEFAULT 0,
  total_budget DECIMAL(14,4) NOT NULL DEFAULT 0,
  daily_cap DECIMAL(14,4) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  approval_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  exclusivity_type VARCHAR(30) NOT NULL DEFAULT 'non_exclusive',
  exclusive_category VARCHAR(100) NULL,
  exclusive_country VARCHAR(2) NULL,
  reserved_impressions BIGINT NOT NULL DEFAULT 0,
  delivered_impressions BIGINT NOT NULL DEFAULT 0,
  spend DECIMAL(14,4) NOT NULL DEFAULT 0,
  overdelivery_allowed TINYINT(1) NOT NULL DEFAULT 0,
  priority_delivery TINYINT(1) NOT NULL DEFAULT 1,
  admin_notes TEXT NULL,
  approved_by INT NULL,
  approved_at DATETIME NULL,
  paused_at DATETIME NULL,
  resumed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_enterprise_deals_advertiser (advertiser_id, status, start_date),
  KEY idx_enterprise_deals_campaign (campaign_type, campaign_id),
  KEY idx_enterprise_deals_dates (start_date, end_date, approval_status, status),
  KEY idx_enterprise_deals_package (package_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS enterprise_inventory_reservations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  deal_id BIGINT UNSIGNED NOT NULL,
  campaign_type VARCHAR(20) NOT NULL DEFAULT 'campaign',
  campaign_id BIGINT UNSIGNED NULL,
  inventory_type VARCHAR(20) NOT NULL,
  inventory_id BIGINT UNSIGNED NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reserved_impressions BIGINT NOT NULL DEFAULT 0,
  delivered_impressions BIGINT NOT NULL DEFAULT 0,
  exclusivity_type VARCHAR(30) NOT NULL DEFAULT 'non_exclusive',
  exclusive_category VARCHAR(100) NULL,
  exclusive_country VARCHAR(2) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'reserved',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_enterprise_reservations_inventory (inventory_type, inventory_id, start_date, end_date, status),
  KEY idx_enterprise_reservations_deal (deal_id),
  CONSTRAINT fk_enterprise_reservations_deal
    FOREIGN KEY (deal_id) REFERENCES enterprise_direct_deals(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS enterprise_featured_marketplace_listings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subject_type VARCHAR(30) NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(160) NULL,
  placement VARCHAR(60) NOT NULL DEFAULT 'marketplace',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_enterprise_featured_subject (subject_type, subject_id, status),
  KEY idx_enterprise_featured_dates (placement, start_date, end_date, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS enterprise_deal_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  deal_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(60) NOT NULL,
  actor_type VARCHAR(30) NOT NULL DEFAULT 'admin',
  actor_id INT NULL,
  message VARCHAR(255) NOT NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_enterprise_audit_deal (deal_id, created_at),
  KEY idx_enterprise_audit_event (event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO sponsorship_packages
  (name, slug, description, miniapp_impressions, channel_posts, bot_broadcasts, featured_marketplace_days, priority_support, estimated_reach, estimated_cpm, package_price, status)
VALUES
  ('Bronze Package', 'bronze', 'Starter enterprise sponsorship package with light premium exposure.', 25000, 2, 1, 3, 0, 20000, 1.5000, 75.0000, 'active'),
  ('Silver Package', 'silver', 'Balanced sponsorship package across Mini Apps, Channels, and Bots.', 75000, 5, 2, 7, 1, 60000, 1.3500, 180.0000, 'active'),
  ('Gold Package', 'gold', 'High-reach premium package with priority support and featured marketplace time.', 200000, 12, 5, 14, 1, 160000, 1.2000, 420.0000, 'active'),
  ('Platinum Package', 'platinum', 'Reserved elite inventory package for major launches and sponsorships.', 500000, 30, 12, 30, 1, 400000, 1.0500, 950.0000, 'active')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO settings (`key`, value) VALUES
  ('enterprise_deals_enabled', '1'),
  ('enterprise_require_admin_approval', '1'),
  ('enterprise_underdelivery_warning_threshold', '0.25'),
  ('enterprise_overdelivery_default_allowed', '0')
ON DUPLICATE KEY UPDATE value = value;
