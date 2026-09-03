-- Additive channel safety foundation. No historical financial rows are mutated.
CREATE TABLE IF NOT EXISTS channel_traffic_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, event_key CHAR(64) NOT NULL,
  event_type ENUM('impression','click') NOT NULL, channel_id INT NOT NULL, campaign_id INT NOT NULL, post_id INT NULL,
  telegram_user_id BIGINT NULL, session_hash CHAR(64) NULL, network_hash CHAR(64) NULL, country_code CHAR(2) NULL,
  device_hash CHAR(64) NULL, duplicate_event TINYINT(1) NOT NULL DEFAULT 0, rapid_burst TINYINT(1) NOT NULL DEFAULT 0,
  concentration_alert TINYINT(1) NOT NULL DEFAULT 0, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  retention_until DATETIME(6) NOT NULL,
  PRIMARY KEY(id), UNIQUE KEY uq_channel_traffic_event_key(event_key),
  KEY idx_channel_traffic_channel_time(channel_id,created_at), KEY idx_channel_traffic_campaign_time(campaign_id,created_at),
  KEY idx_channel_traffic_network_time(network_hash,created_at), KEY idx_channel_traffic_device_time(device_hash,created_at),
  KEY idx_channel_traffic_user_time(telegram_user_id,created_at), KEY idx_channel_traffic_session_time(session_hash,created_at),
  KEY idx_channel_traffic_retention(retention_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS publisher_risk_assessments (
  publisher_id INT NOT NULL, risk_score INT UNSIGNED NOT NULL, risk_state ENUM('low','medium','high','critical') NOT NULL,
  reasons JSON NOT NULL, inputs JSON NOT NULL, assessed_at DATETIME NOT NULL, PRIMARY KEY(publisher_id), KEY idx_publisher_risk_state(risk_state,assessed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS withdrawal_preclearance_assessments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, withdrawal_id INT NOT NULL, state ENUM('cleared','manual_review_required') NOT NULL,
  reasons JSON NOT NULL, assessment JSON NOT NULL, assessed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(id), KEY idx_withdrawal_preclearance(withdrawal_id,assessed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS channel_geo_classifications (
  channel_id INT NOT NULL, selected_region VARCHAR(32) NULL, authoritative_region VARCHAR(32) NULL,
  confidence ENUM('unknown','publisher_declared','low','medium','high','verified') NOT NULL DEFAULT 'unknown',
  source VARCHAR(64) NOT NULL, reason VARCHAR(255) NOT NULL, evidence JSON NULL, conflict_detected TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('current','review_required','stale') NOT NULL DEFAULT 'current', classified_by INT NULL,
  classified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY(channel_id), KEY idx_channel_geo_review(status,conflict_detected)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_enforcement_exemptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, user_id INT NOT NULL, scope VARCHAR(64) NOT NULL,
  exemption_type VARCHAR(64) NOT NULL, reason VARCHAR(500) NOT NULL, created_by INT NULL, updated_by INT NULL,
  expires_at DATETIME NULL, active TINYINT(1) NOT NULL DEFAULT 1, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY(id), UNIQUE KEY uq_user_enforcement_scope(user_id,scope), KEY idx_enforcement_active(scope,active,expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channels' AND INDEX_NAME='idx_channels_fraud_coverage')=0,
  'CREATE INDEX idx_channels_fraud_coverage ON channels (is_deleted,status,fraud_last_evaluated_at,id)', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
