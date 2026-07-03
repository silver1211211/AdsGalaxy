-- Channel-only fraud detection state, evaluations, and immutable events.
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channels' AND COLUMN_NAME='publisher_trust_score')=0,
  'ALTER TABLE channels ADD COLUMN publisher_trust_score DECIMAL(8,4) NOT NULL DEFAULT 60', 'SELECT 1');
PREPARE channel_fraud_stmt FROM @ddl; EXECUTE channel_fraud_stmt; DEALLOCATE PREPARE channel_fraud_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channels' AND COLUMN_NAME='channel_fraud_risk_score')=0,
  'ALTER TABLE channels ADD COLUMN channel_fraud_risk_score DECIMAL(8,4) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE channel_fraud_stmt FROM @ddl; EXECUTE channel_fraud_stmt; DEALLOCATE PREPARE channel_fraud_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channels' AND COLUMN_NAME='fraud_clean_streak')=0,
  'ALTER TABLE channels ADD COLUMN fraud_clean_streak INT UNSIGNED NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE channel_fraud_stmt FROM @ddl; EXECUTE channel_fraud_stmt; DEALLOCATE PREPARE channel_fraud_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channels' AND COLUMN_NAME='fraud_last_evaluated_at')=0,
  'ALTER TABLE channels ADD COLUMN fraud_last_evaluated_at DATETIME NULL', 'SELECT 1');
PREPARE channel_fraud_stmt FROM @ddl; EXECUTE channel_fraud_stmt; DEALLOCATE PREPARE channel_fraud_stmt;
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='publisher_trust_score')=0,
  'ALTER TABLE users ADD COLUMN publisher_trust_score DECIMAL(8,4) NOT NULL DEFAULT 60', 'SELECT 1');
PREPARE channel_fraud_stmt FROM @ddl; EXECUTE channel_fraud_stmt; DEALLOCATE PREPARE channel_fraud_stmt;

CREATE TABLE IF NOT EXISTS channel_fraud_evaluations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  channel_id INT NOT NULL,
  publisher_id INT NOT NULL,
  evaluation_bucket DATETIME NOT NULL,
  signal_count INT UNSIGNED NOT NULL DEFAULT 0,
  highest_severity ENUM('none','low','medium','high','critical') NOT NULL DEFAULT 'none',
  old_trust_score DECIMAL(8,4) NOT NULL,
  new_trust_score DECIMAL(8,4) NOT NULL,
  old_risk_score DECIMAL(8,4) NOT NULL,
  new_risk_score DECIMAL(8,4) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_channel_fraud_evaluation_bucket (channel_id, evaluation_bucket),
  KEY idx_channel_fraud_eval_publisher (publisher_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS channel_fraud_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  evaluation_id BIGINT UNSIGNED NOT NULL,
  channel_id INT NOT NULL,
  publisher_id INT NOT NULL,
  campaign_id INT NULL,
  post_id INT NULL,
  fraud_type VARCHAR(80) NOT NULL,
  severity ENUM('low','medium','high','critical') NOT NULL,
  old_trust_score DECIMAL(8,4) NOT NULL,
  new_trust_score DECIMAL(8,4) NOT NULL,
  old_risk_score DECIMAL(8,4) NOT NULL,
  new_risk_score DECIMAL(8,4) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_channel_fraud_events_channel (channel_id, created_at),
  KEY idx_channel_fraud_events_publisher (publisher_id, severity, created_at),
  KEY idx_channel_fraud_events_post (post_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO settings (`key`, value, description) VALUES
  ('channel_fraud_auto_ban_enabled', '1', 'Enable final channel publisher ban rule after sustained critical evidence'),
  ('channel_fraud_ban_risk_threshold', '95', 'Minimum publisher risk score for final fraud ban'),
  ('channel_fraud_ban_trust_threshold', '-60', 'Maximum publisher trust score for final fraud ban'),
  ('channel_fraud_ban_critical_evaluations', '3', 'Distinct critical evaluations required for final fraud ban'),
  ('channel_fraud_ban_observation_hours', '24', 'Minimum observation window before final fraud ban')
ON DUPLICATE KEY UPDATE description=VALUES(description);
