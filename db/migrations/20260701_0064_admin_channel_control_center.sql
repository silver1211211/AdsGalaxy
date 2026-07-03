-- Admin-only operational controls for channel trust, review, and settlement.
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channels' AND COLUMN_NAME='under_review')=0,
  'ALTER TABLE channels ADD COLUMN under_review TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE control_stmt FROM @ddl; EXECUTE control_stmt; DEALLOCATE PREPARE control_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channels' AND COLUMN_NAME='trust_score_frozen_until')=0,
  'ALTER TABLE channels ADD COLUMN trust_score_frozen_until DATETIME NULL', 'SELECT 1');
PREPARE control_stmt FROM @ddl; EXECUTE control_stmt; DEALLOCATE PREPARE control_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channels' AND COLUMN_NAME='settlement_excluded_until')=0,
  'ALTER TABLE channels ADD COLUMN settlement_excluded_until DATETIME NULL', 'SELECT 1');
PREPARE control_stmt FROM @ddl; EXECUTE control_stmt; DEALLOCATE PREPARE control_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channels' AND COLUMN_NAME='settlement_exclusion_reason')=0,
  'ALTER TABLE channels ADD COLUMN settlement_exclusion_reason VARCHAR(500) NULL', 'SELECT 1');
PREPARE control_stmt FROM @ddl; EXECUTE control_stmt; DEALLOCATE PREPARE control_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_fraud_events' AND COLUMN_NAME='false_positive_at')=0,
  'ALTER TABLE channel_fraud_events ADD COLUMN false_positive_at DATETIME NULL, ADD COLUMN false_positive_by INT NULL, ADD COLUMN false_positive_reason VARCHAR(500) NULL', 'SELECT 1');
PREPARE control_stmt FROM @ddl; EXECUTE control_stmt; DEALLOCATE PREPARE control_stmt;

CREATE TABLE IF NOT EXISTS channel_admin_action_audits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id INT NULL,
  action VARCHAR(80) NOT NULL,
  channel_id INT NOT NULL,
  publisher_id INT NOT NULL,
  old_value JSON NULL,
  new_value JSON NULL,
  reason VARCHAR(500) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_channel_admin_audit_channel (channel_id,created_at),
  KEY idx_channel_admin_audit_publisher (publisher_id,created_at),
  KEY idx_channel_admin_audit_admin (admin_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
