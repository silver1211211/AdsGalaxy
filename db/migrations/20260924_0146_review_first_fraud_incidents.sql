-- Review-first publisher safety: deduplicate recurring evidence while preserving history.
CREATE TABLE IF NOT EXISTS channel_fraud_incidents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  incident_key CHAR(64) NOT NULL,
  channel_id INT NOT NULL,
  publisher_id INT NOT NULL,
  campaign_id INT NULL,
  post_id INT NULL,
  fraud_type VARCHAR(80) NOT NULL,
  max_severity ENUM('low','medium','high','critical') NOT NULL,
  status ENUM('open','cleared','false_positive') NOT NULL DEFAULT 'open',
  first_seen_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  times_seen INT UNSIGNED NOT NULL DEFAULT 1,
  trust_penalty_applied DECIMAL(8,4) NOT NULL DEFAULT 0,
  risk_penalty_applied DECIMAL(8,4) NOT NULL DEFAULT 0,
  last_reason VARCHAR(500) NOT NULL,
  last_metadata JSON NULL,
  reviewed_at DATETIME NULL,
  reviewed_by INT NULL,
  review_note VARCHAR(500) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_channel_fraud_incident_key (incident_key),
  KEY idx_channel_fraud_incident_review (status,max_severity,last_seen_at),
  KEY idx_channel_fraud_incident_publisher (publisher_id,status,last_seen_at),
  KEY idx_channel_fraud_incident_channel (channel_id,status,last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO settings (`key`,value,description) VALUES
  ('publisher_trust_enforcement_mode','review_only','Automated trust evaluation opens Admin Check cases and never bans publishers'),
  ('channel_fraud_max_trust_penalty_per_evaluation','10','Maximum trust deduction for new independent incidents in one daily evaluation'),
  ('channel_fraud_max_risk_increase_per_evaluation','15','Maximum risk increase for new independent incidents in one daily evaluation')
ON DUPLICATE KEY UPDATE value=VALUES(value),description=VALUES(description);
