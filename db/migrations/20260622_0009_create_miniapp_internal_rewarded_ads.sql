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

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_rewarded_campaigns')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_rewarded_campaigns' AND INDEX_NAME = 'idx_miniapp_rewarded_campaigns_status_budget'),
  'CREATE INDEX idx_miniapp_rewarded_campaigns_status_budget ON miniapp_rewarded_campaigns (status, remaining_budget)', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_rewarded_campaigns')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_rewarded_campaigns' AND INDEX_NAME = 'idx_miniapp_rewarded_campaigns_advertiser_created'),
  'CREATE INDEX idx_miniapp_rewarded_campaigns_advertiser_created ON miniapp_rewarded_campaigns (advertiser_id, created_at)', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_rewarded_campaigns')
  AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_rewarded_campaigns' AND CONSTRAINT_NAME = 'fk_miniapp_rewarded_campaigns_advertiser'),
  'ALTER TABLE miniapp_rewarded_campaigns ADD CONSTRAINT fk_miniapp_rewarded_campaigns_advertiser FOREIGN KEY (advertiser_id) REFERENCES users(id) ON DELETE CASCADE', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

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

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_internal_ad_impressions')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_internal_ad_impressions' AND INDEX_NAME = 'uniq_miniapp_internal_ad_request'),
  'CREATE UNIQUE INDEX uniq_miniapp_internal_ad_request ON miniapp_internal_ad_impressions (request_id)', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_internal_ad_impressions')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_internal_ad_impressions' AND INDEX_NAME = 'idx_miniapp_internal_ad_campaign_created'),
  'CREATE INDEX idx_miniapp_internal_ad_campaign_created ON miniapp_internal_ad_impressions (campaign_id, created_at)', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_internal_ad_impressions')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_internal_ad_impressions' AND INDEX_NAME = 'idx_miniapp_internal_ad_miniapp_created'),
  'CREATE INDEX idx_miniapp_internal_ad_miniapp_created ON miniapp_internal_ad_impressions (miniapp_id, created_at)', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_internal_ad_impressions')
  AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_rewarded_campaigns')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_internal_ad_impressions' AND CONSTRAINT_NAME = 'fk_miniapp_internal_ad_impressions_campaign'),
  'ALTER TABLE miniapp_internal_ad_impressions ADD CONSTRAINT fk_miniapp_internal_ad_impressions_campaign FOREIGN KEY (campaign_id) REFERENCES miniapp_rewarded_campaigns(id) ON DELETE CASCADE', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_internal_ad_impressions')
  AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapps')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_internal_ad_impressions' AND CONSTRAINT_NAME = 'fk_miniapp_internal_ad_impressions_miniapp'),
  'ALTER TABLE miniapp_internal_ad_impressions ADD CONSTRAINT fk_miniapp_internal_ad_impressions_miniapp FOREIGN KEY (miniapp_id) REFERENCES miniapps(id) ON DELETE CASCADE', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests' AND COLUMN_NAME = 'internal_campaign_id'),
  'ALTER TABLE miniapp_mediation_requests ADD COLUMN internal_campaign_id BIGINT UNSIGNED NULL AFTER selected_network',
  'SELECT 1'
);
PREPARE migration_stmt FROM @migration_sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests')
  AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests' AND COLUMN_NAME = 'internal_campaign_id')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests' AND INDEX_NAME = 'idx_miniapp_mediation_internal_campaign'),
  'CREATE INDEX idx_miniapp_mediation_internal_campaign ON miniapp_mediation_requests (internal_campaign_id)',
  'SELECT 1'
);
PREPARE migration_stmt FROM @migration_sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

INSERT INTO settings (`key`, value)
VALUES ('internal_ads_max_share_percent', '20')
ON DUPLICATE KEY UPDATE value = value;
