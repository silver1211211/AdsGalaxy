-- Unified channel operational health state and immutable check history.
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channels' AND COLUMN_NAME='health_score')=0,
  'ALTER TABLE channels ADD COLUMN health_score TINYINT UNSIGNED NOT NULL DEFAULT 100 AFTER health_status', 'SELECT 1');
PREPARE health_stmt FROM @ddl; EXECUTE health_stmt; DEALLOCATE PREPARE health_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channels' AND COLUMN_NAME='health_failure_reason')=0,
  'ALTER TABLE channels ADD COLUMN health_failure_reason VARCHAR(500) NULL AFTER health_score', 'SELECT 1');
PREPARE health_stmt FROM @ddl; EXECUTE health_stmt; DEALLOCATE PREPARE health_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channels' AND COLUMN_NAME='health_details')=0,
  'ALTER TABLE channels ADD COLUMN health_details JSON NULL AFTER health_failure_reason', 'SELECT 1');
PREPARE health_stmt FROM @ddl; EXECUTE health_stmt; DEALLOCATE PREPARE health_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channels' AND COLUMN_NAME='last_successful_view_fetch_at')=0,
  'ALTER TABLE channels ADD COLUMN last_successful_view_fetch_at DATETIME NULL AFTER last_successful_post_at', 'SELECT 1');
PREPARE health_stmt FROM @ddl; EXECUTE health_stmt; DEALLOCATE PREPARE health_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channels' AND COLUMN_NAME='last_successful_settlement_at')=0,
  'ALTER TABLE channels ADD COLUMN last_successful_settlement_at DATETIME NULL AFTER last_successful_view_fetch_at', 'SELECT 1');
PREPARE health_stmt FROM @ddl; EXECUTE health_stmt; DEALLOCATE PREPARE health_stmt;

UPDATE channels SET health_status=CASE
  WHEN is_deleted=TRUE OR status IN ('deleted','rejected') THEN 'disabled'
  WHEN status IN ('bot_removed','channel_not_found','permission_missing') THEN 'critical'
  WHEN health_status IN ('paused','unreachable') THEN 'warning'
  ELSE 'healthy' END
WHERE health_status IS NULL OR health_status NOT IN ('healthy','warning','critical','disabled');

CREATE TABLE IF NOT EXISTS channel_health_checks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  channel_id INT NOT NULL,
  status ENUM('healthy','warning','critical','disabled') NOT NULL,
  health_score TINYINT UNSIGNED NOT NULL,
  posting_score TINYINT UNSIGNED NOT NULL,
  view_fetch_score TINYINT UNSIGNED NOT NULL,
  settlement_score TINYINT UNSIGNED NOT NULL,
  quality_score TINYINT UNSIGNED NOT NULL,
  access_score TINYINT UNSIGNED NOT NULL,
  issues JSON NULL,
  suggested_fix VARCHAR(500) NULL,
  auto_paused TINYINT(1) NOT NULL DEFAULT 0,
  checked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_channel_health_checks_channel (channel_id,checked_at),
  KEY idx_channel_health_checks_status (status,checked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO settings (`key`,value,description) VALUES
  ('channel_health_auto_pause_critical','0','Pause channel lifecycle status when hourly health reaches critical')
ON DUPLICATE KEY UPDATE description=VALUES(description);
