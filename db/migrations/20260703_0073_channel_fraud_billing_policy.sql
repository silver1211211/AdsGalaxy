ALTER TABLE channel_fraud_events
  ADD COLUMN IF NOT EXISTS billing_state ENUM('clean','low_quality','suspicious','confirmed_fraud','critical_fraud') NOT NULL DEFAULT 'clean' AFTER severity;

UPDATE channel_fraud_events
SET billing_state = CASE
  WHEN severity = 'critical' THEN 'critical_fraud'
  WHEN severity = 'high' THEN 'suspicious'
  WHEN severity = 'medium' THEN 'low_quality'
  ELSE 'clean'
END
WHERE billing_state = 'clean';

ALTER TABLE campaign_posts
  ADD COLUMN IF NOT EXISTS fraud_excluded_views INT UNSIGNED NOT NULL DEFAULT 0 AFTER settled_views,
  ADD COLUMN IF NOT EXISTS fraud_excluded_clicks INT UNSIGNED NOT NULL DEFAULT 0 AFTER settled_clicks;

ALTER TABLE ad_settlements
  ADD COLUMN IF NOT EXISTS fraud_adjusted_at DATETIME NULL AFTER status;
ALTER TABLE ad_settlements_views
  ADD COLUMN IF NOT EXISTS fraud_adjusted_at DATETIME NULL AFTER status;

CREATE TABLE IF NOT EXISTS channel_fraud_billing_adjustments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  settlement_ledger_id BIGINT UNSIGNED NOT NULL,
  fraud_event_id BIGINT UNSIGNED NOT NULL,
  settlement_type ENUM('view','click') NOT NULL,
  campaign_id INT NOT NULL,
  post_id INT NOT NULL,
  channel_id INT NOT NULL,
  publisher_id INT NOT NULL,
  advertiser_id INT NOT NULL,
  fraud_billing_state ENUM('confirmed_fraud','critical_fraud') NOT NULL,
  fraudulent_units INT UNSIGNED NOT NULL,
  advertiser_credit DECIMAL(18,8) NOT NULL,
  publisher_credit_reversed DECIMAL(18,8) NOT NULL,
  publisher_balance_recovered DECIMAL(18,8) NOT NULL,
  platform_revenue_reversed DECIMAL(18,8) NOT NULL,
  reserve_amount_reversed DECIMAL(18,8) NOT NULL,
  reserve_shortfall DECIMAL(18,8) NOT NULL DEFAULT 0,
  reason VARCHAR(500) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_channel_fraud_adjustment_settlement (settlement_ledger_id),
  KEY idx_channel_fraud_adjustment_campaign (campaign_id, created_at),
  KEY idx_channel_fraud_adjustment_event (fraud_event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
