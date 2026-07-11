-- Phase 12: rule-based Mini App optimization controls, health scoring, and review flags.

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_network_health')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_network_health' AND COLUMN_NAME = 'health_score'),
  'ALTER TABLE miniapp_network_health ADD COLUMN health_score INT NOT NULL DEFAULT 100 AFTER network_name', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_network_health')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_network_health' AND COLUMN_NAME = 'last_success_at'),
  'ALTER TABLE miniapp_network_health ADD COLUMN last_success_at DATETIME NULL AFTER last_failure_at', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_network_health')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_network_health' AND COLUMN_NAME = 'no_fill_count'),
  'ALTER TABLE miniapp_network_health ADD COLUMN no_fill_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER recent_failures', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_network_health')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_network_health' AND COLUMN_NAME = 'timeout_count'),
  'ALTER TABLE miniapp_network_health ADD COLUMN timeout_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER no_fill_count', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_network_health')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_network_health' AND COLUMN_NAME = 'sdk_load_failure_count'),
  'ALTER TABLE miniapp_network_health ADD COLUMN sdk_load_failure_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER timeout_count', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

CREATE TABLE IF NOT EXISTS miniapp_optimization_flags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  telegram_user_id BIGINT NULL,
  flag_type VARCHAR(80) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'review',
  details JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_miniapp_optimization_flags_miniapp_created (miniapp_id, created_at),
  KEY idx_miniapp_optimization_flags_user_created (telegram_user_id, created_at),
  CONSTRAINT fk_miniapp_optimization_flags_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_optimization_flags')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_optimization_flags' AND INDEX_NAME = 'idx_miniapp_optimization_flags_miniapp_created'),
  'CREATE INDEX idx_miniapp_optimization_flags_miniapp_created ON miniapp_optimization_flags (miniapp_id, created_at)', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_optimization_flags')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_optimization_flags' AND INDEX_NAME = 'idx_miniapp_optimization_flags_user_created'),
  'CREATE INDEX idx_miniapp_optimization_flags_user_created ON miniapp_optimization_flags (telegram_user_id, created_at)', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @migration_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_optimization_flags')
  AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapps')
  AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_optimization_flags' AND CONSTRAINT_NAME = 'fk_miniapp_optimization_flags_miniapp'),
  'ALTER TABLE miniapp_optimization_flags ADD CONSTRAINT fk_miniapp_optimization_flags_miniapp FOREIGN KEY (miniapp_id) REFERENCES miniapps(id) ON DELETE CASCADE', 'SELECT 1');
PREPARE migration_stmt FROM @migration_sql; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

INSERT INTO settings (`key`, value)
VALUES
  ('internal_ads_max_share_percent', '20'),
  ('internal_campaign_user_cooldown_minutes', '30'),
  ('internal_campaign_miniapp_max_share_percent', '30'),
  ('network_failure_disable_threshold', '5'),
  ('network_failure_window_minutes', '10'),
  ('network_disable_duration_minutes', '15')
ON DUPLICATE KEY UPDATE value = value;
