-- Phase 10: Publisher marketplace, public inventory discovery, direct placement selection.
-- Additive only. Does not change CPM engines, payouts, withdrawals, fraud, conversions, or network integrations.

ALTER TABLE miniapps
  ADD COLUMN IF NOT EXISTS marketplace_visible TINYINT(1) NOT NULL DEFAULT 1 AFTER inventory_updated_at,
  ADD COLUMN IF NOT EXISTS marketplace_admin_status VARCHAR(20) NOT NULL DEFAULT 'approved' AFTER marketplace_visible,
  ADD COLUMN IF NOT EXISTS marketplace_featured TINYINT(1) NOT NULL DEFAULT 0 AFTER marketplace_admin_status,
  ADD COLUMN IF NOT EXISTS marketplace_pinned TINYINT(1) NOT NULL DEFAULT 0 AFTER marketplace_featured,
  ADD COLUMN IF NOT EXISTS marketplace_highlighted TINYINT(1) NOT NULL DEFAULT 0 AFTER marketplace_pinned,
  ADD COLUMN IF NOT EXISTS marketplace_category VARCHAR(100) NULL AFTER marketplace_highlighted,
  ADD COLUMN IF NOT EXISTS marketplace_country VARCHAR(2) NULL AFTER marketplace_category,
  ADD COLUMN IF NOT EXISTS marketplace_language VARCHAR(16) NULL AFTER marketplace_country,
  ADD COLUMN IF NOT EXISTS marketplace_average_cpm DECIMAL(10,4) NULL AFTER marketplace_language,
  ADD COLUMN IF NOT EXISTS marketplace_direct_min_cpm DECIMAL(10,4) NULL AFTER marketplace_average_cpm,
  ADD COLUMN IF NOT EXISTS marketplace_premium_cpm DECIMAL(10,4) NULL AFTER marketplace_direct_min_cpm,
  ADD COLUMN IF NOT EXISTS marketplace_featured_cpm DECIMAL(10,4) NULL AFTER marketplace_premium_cpm,
  ADD COLUMN IF NOT EXISTS marketplace_monthly_impressions BIGINT NOT NULL DEFAULT 0 AFTER marketplace_featured_cpm,
  ADD COLUMN IF NOT EXISTS marketplace_avg_completion_rate DECIMAL(10,4) NOT NULL DEFAULT 0 AFTER marketplace_monthly_impressions;

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS marketplace_visible TINYINT(1) NOT NULL DEFAULT 1 AFTER inventory_updated_at,
  ADD COLUMN IF NOT EXISTS marketplace_admin_status VARCHAR(20) NOT NULL DEFAULT 'approved' AFTER marketplace_visible,
  ADD COLUMN IF NOT EXISTS marketplace_featured TINYINT(1) NOT NULL DEFAULT 0 AFTER marketplace_admin_status,
  ADD COLUMN IF NOT EXISTS marketplace_pinned TINYINT(1) NOT NULL DEFAULT 0 AFTER marketplace_featured,
  ADD COLUMN IF NOT EXISTS marketplace_highlighted TINYINT(1) NOT NULL DEFAULT 0 AFTER marketplace_pinned,
  ADD COLUMN IF NOT EXISTS marketplace_category VARCHAR(100) NULL AFTER marketplace_highlighted,
  ADD COLUMN IF NOT EXISTS marketplace_country VARCHAR(2) NULL AFTER marketplace_category,
  ADD COLUMN IF NOT EXISTS marketplace_language VARCHAR(16) NULL AFTER marketplace_country,
  ADD COLUMN IF NOT EXISTS marketplace_average_cpm DECIMAL(10,4) NULL AFTER marketplace_language,
  ADD COLUMN IF NOT EXISTS marketplace_direct_min_cpm DECIMAL(10,4) NULL AFTER marketplace_average_cpm,
  ADD COLUMN IF NOT EXISTS marketplace_premium_cpm DECIMAL(10,4) NULL AFTER marketplace_direct_min_cpm,
  ADD COLUMN IF NOT EXISTS marketplace_featured_cpm DECIMAL(10,4) NULL AFTER marketplace_premium_cpm,
  ADD COLUMN IF NOT EXISTS marketplace_monthly_impressions BIGINT NOT NULL DEFAULT 0 AFTER marketplace_featured_cpm,
  ADD COLUMN IF NOT EXISTS marketplace_avg_completion_rate DECIMAL(10,4) NOT NULL DEFAULT 0 AFTER marketplace_monthly_impressions;

ALTER TABLE bots
  ADD COLUMN IF NOT EXISTS marketplace_visible TINYINT(1) NOT NULL DEFAULT 1 AFTER inventory_updated_at,
  ADD COLUMN IF NOT EXISTS marketplace_admin_status VARCHAR(20) NOT NULL DEFAULT 'approved' AFTER marketplace_visible,
  ADD COLUMN IF NOT EXISTS marketplace_featured TINYINT(1) NOT NULL DEFAULT 0 AFTER marketplace_admin_status,
  ADD COLUMN IF NOT EXISTS marketplace_pinned TINYINT(1) NOT NULL DEFAULT 0 AFTER marketplace_featured,
  ADD COLUMN IF NOT EXISTS marketplace_highlighted TINYINT(1) NOT NULL DEFAULT 0 AFTER marketplace_pinned,
  ADD COLUMN IF NOT EXISTS marketplace_category VARCHAR(100) NULL AFTER marketplace_highlighted,
  ADD COLUMN IF NOT EXISTS marketplace_country VARCHAR(2) NULL AFTER marketplace_category,
  ADD COLUMN IF NOT EXISTS marketplace_language VARCHAR(16) NULL AFTER marketplace_country,
  ADD COLUMN IF NOT EXISTS marketplace_average_cpm DECIMAL(10,4) NULL AFTER marketplace_language,
  ADD COLUMN IF NOT EXISTS marketplace_direct_min_cpm DECIMAL(10,4) NULL AFTER marketplace_average_cpm,
  ADD COLUMN IF NOT EXISTS marketplace_premium_cpm DECIMAL(10,4) NULL AFTER marketplace_direct_min_cpm,
  ADD COLUMN IF NOT EXISTS marketplace_featured_cpm DECIMAL(10,4) NULL AFTER marketplace_premium_cpm,
  ADD COLUMN IF NOT EXISTS marketplace_monthly_impressions BIGINT NOT NULL DEFAULT 0 AFTER marketplace_featured_cpm,
  ADD COLUMN IF NOT EXISTS marketplace_avg_completion_rate DECIMAL(10,4) NOT NULL DEFAULT 0 AFTER marketplace_monthly_impressions;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS direct_placement_mode VARCHAR(20) NOT NULL DEFAULT 'network' AFTER delivery_quality_rating,
  ADD COLUMN IF NOT EXISTS direct_inventory_scope VARCHAR(20) NOT NULL DEFAULT 'network' AFTER direct_placement_mode,
  ADD COLUMN IF NOT EXISTS direct_inventory_metadata JSON NULL AFTER direct_inventory_scope;

ALTER TABLE miniapp_rewarded_campaigns
  ADD COLUMN IF NOT EXISTS direct_placement_mode VARCHAR(20) NOT NULL DEFAULT 'network' AFTER delivery_quality_rating,
  ADD COLUMN IF NOT EXISTS direct_inventory_scope VARCHAR(20) NOT NULL DEFAULT 'network' AFTER direct_placement_mode,
  ADD COLUMN IF NOT EXISTS direct_inventory_metadata JSON NULL AFTER direct_inventory_scope;

CREATE TABLE IF NOT EXISTS campaign_direct_inventory_targets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_type VARCHAR(20) NOT NULL,
  campaign_id BIGINT UNSIGNED NOT NULL,
  inventory_type VARCHAR(20) NOT NULL,
  inventory_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_campaign_inventory_target (campaign_type, campaign_id, inventory_type, inventory_id),
  KEY idx_direct_targets_campaign (campaign_type, campaign_id),
  KEY idx_direct_targets_inventory (inventory_type, inventory_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_favorites (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  advertiser_id INT NOT NULL,
  inventory_type VARCHAR(20) NOT NULL,
  inventory_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_inventory_favorite (advertiser_id, inventory_type, inventory_id),
  KEY idx_inventory_favorites_inventory (inventory_type, inventory_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_lists (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  advertiser_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_inventory_lists_advertiser (advertiser_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_list_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  list_id BIGINT UNSIGNED NOT NULL,
  inventory_type VARCHAR(20) NOT NULL,
  inventory_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_inventory_list_item (list_id, inventory_type, inventory_id),
  KEY idx_inventory_list_items_inventory (inventory_type, inventory_id),
  CONSTRAINT fk_inventory_list_items_list
    FOREIGN KEY (list_id) REFERENCES inventory_lists(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_marketplace_analytics (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  advertiser_id INT NULL,
  inventory_type VARCHAR(20) NOT NULL,
  inventory_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_marketplace_analytics_inventory (inventory_type, inventory_id, event_type, created_at),
  KEY idx_marketplace_analytics_advertiser (advertiser_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO settings (`key`, value) VALUES
  ('direct_placement_min_cpm', '0'),
  ('direct_placement_premium_cpm', '0'),
  ('direct_placement_featured_cpm', '0')
ON DUPLICATE KEY UPDATE value = value;
