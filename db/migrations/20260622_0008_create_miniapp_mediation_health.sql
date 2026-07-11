-- Phase 9: mediation engine request decisions, fallback attempts, and per-Mini-App network health.

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_ad_networks')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_ad_networks' AND COLUMN_NAME = 'priority_order'),
  'ALTER TABLE miniapp_ad_networks ADD COLUMN priority_order INT NOT NULL DEFAULT 0 AFTER enabled',
  'SELECT 1'
);
PREPARE migration_stmt FROM @migration_sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_ad_networks' AND COLUMN_NAME = 'priority_order'),
  'UPDATE miniapp_ad_networks SET priority_order = CASE network_name WHEN ''AdsGram'' THEN 1 WHEN ''Monetag'' THEN 2 WHEN ''AdExium'' THEN 3 WHEN ''RichAds'' THEN 4 ELSE 99 END WHERE priority_order = 0',
  'SELECT 1'
);
PREPARE migration_stmt FROM @migration_sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests' AND COLUMN_NAME = 'parent_request_id'),
  'ALTER TABLE miniapp_mediation_requests ADD COLUMN parent_request_id VARCHAR(64) NULL AFTER request_id', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests' AND COLUMN_NAME = 'root_request_id'),
  'ALTER TABLE miniapp_mediation_requests ADD COLUMN root_request_id VARCHAR(64) NULL AFTER parent_request_id', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests' AND COLUMN_NAME = 'candidate_networks'),
  'ALTER TABLE miniapp_mediation_requests ADD COLUMN candidate_networks JSON NULL AFTER root_request_id', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests' AND COLUMN_NAME = 'attempted_networks'),
  'ALTER TABLE miniapp_mediation_requests ADD COLUMN attempted_networks JSON NULL AFTER candidate_networks', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests' AND COLUMN_NAME = 'skipped_networks'),
  'ALTER TABLE miniapp_mediation_requests ADD COLUMN skipped_networks JSON NULL AFTER attempted_networks', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests' AND COLUMN_NAME = 'fallback_attempts'),
  'ALTER TABLE miniapp_mediation_requests ADD COLUMN fallback_attempts JSON NULL AFTER skipped_networks', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests' AND COLUMN_NAME = 'decision_reason'),
  'ALTER TABLE miniapp_mediation_requests ADD COLUMN decision_reason VARCHAR(255) NULL AFTER fallback_attempts', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests' AND COLUMN_NAME = 'final_result'),
  'ALTER TABLE miniapp_mediation_requests ADD COLUMN final_result VARCHAR(50) NULL AFTER decision_reason', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests' AND INDEX_NAME = 'idx_miniapp_mediation_requests_root'),
  'CREATE INDEX idx_miniapp_mediation_requests_root ON miniapp_mediation_requests (root_request_id)', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests' AND INDEX_NAME = 'idx_miniapp_mediation_requests_final'),
  'CREATE INDEX idx_miniapp_mediation_requests_final ON miniapp_mediation_requests (miniapp_id, final_result, created_at)', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests' AND COLUMN_NAME = 'root_request_id')
  AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests' AND COLUMN_NAME = 'request_id'),
  'UPDATE miniapp_mediation_requests SET root_request_id = request_id WHERE root_request_id IS NULL',
  'SELECT 1'
);
PREPARE migration_stmt FROM @migration_sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

CREATE TABLE IF NOT EXISTS miniapp_network_failures (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  network_name VARCHAR(50) NOT NULL,
  request_id VARCHAR(64) NULL,
  error_code VARCHAR(50) NOT NULL,
  error_message VARCHAR(255) NULL,
  ad_format VARCHAR(50) NOT NULL DEFAULT 'rewarded',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_miniapp_network_failures_recent (miniapp_id, network_name, created_at),
  KEY idx_miniapp_network_failures_request (request_id),
  CONSTRAINT fk_miniapp_network_failures_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS miniapp_network_health (
  miniapp_id BIGINT UNSIGNED NOT NULL,
  network_name VARCHAR(50) NOT NULL,
  recent_failures INT UNSIGNED NOT NULL DEFAULT 0,
  last_failure_at DATETIME NULL,
  temporarily_disabled_until DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (miniapp_id, network_name),
  KEY idx_miniapp_network_health_disabled (network_name, temporarily_disabled_until),
  CONSTRAINT fk_miniapp_network_health_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
