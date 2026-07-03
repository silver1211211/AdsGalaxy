CREATE TABLE IF NOT EXISTS campaign_inventory_exclusions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_type ENUM('campaign', 'miniapp') NOT NULL,
  campaign_id BIGINT UNSIGNED NOT NULL,
  inventory_type ENUM('channel', 'bot', 'miniapp') NOT NULL,
  normalized_identifier VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_campaign_inventory_exclusion (campaign_type, campaign_id, inventory_type, normalized_identifier),
  KEY idx_campaign_inventory_exclusion_lookup (campaign_type, campaign_id, inventory_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
