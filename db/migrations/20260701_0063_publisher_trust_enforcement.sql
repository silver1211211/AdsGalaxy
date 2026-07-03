-- Exact publisher auto-ban policy: trust below 20 AND withdrawable balance at least 9.80.
CREATE TABLE IF NOT EXISTS publisher_trust_enforcement_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  publisher_id INT NOT NULL,
  evaluation_bucket DATETIME NOT NULL,
  trust_score DECIMAL(8,4) NOT NULL,
  available_balance DECIMAL(18,8) NOT NULL,
  balance_threshold DECIMAL(18,8) NOT NULL DEFAULT 9.80000000,
  decision ENUM('monitoring','banned') NOT NULL,
  reason VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_publisher_trust_enforcement_bucket (publisher_id,evaluation_bucket),
  KEY idx_publisher_trust_enforcement_decision (decision,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Remove the superseded risk/observation-window ban policy. Enforcement is now
-- governed only by publisher_trust_score < 20 and balance_available >= 9.80.
DELETE FROM settings WHERE `key` IN (
  'channel_fraud_auto_ban_enabled',
  'channel_fraud_ban_risk_threshold',
  'channel_fraud_ban_trust_threshold',
  'channel_fraud_ban_critical_evaluations',
  'channel_fraud_ban_observation_hours'
);
