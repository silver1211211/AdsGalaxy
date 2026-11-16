CREATE TABLE channel_smart_reach_cpm_evaluations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  campaign_id INT NOT NULL,
  evaluation_slot BIGINT UNSIGNED NOT NULL,
  qualified_impressions BIGINT UNSIGNED NOT NULL,
  settled_clicks BIGINT UNSIGNED NOT NULL,
  previous_cpm DECIMAL(24,8) NOT NULL,
  next_cpm DECIMAL(24,8) NOT NULL,
  ceiling_cpm DECIMAL(24,8) NOT NULL,
  observed_minutes INT UNSIGNED NOT NULL,
  evaluated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_smart_cpm_campaign_slot (campaign_id,evaluation_slot),
  KEY ix_smart_cpm_campaign_time (campaign_id,evaluated_at),
  CONSTRAINT fk_smart_cpm_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT,
  CONSTRAINT chk_smart_cpm_rates CHECK (previous_cpm BETWEEN 0.10000000 AND 0.50000000
    AND next_cpm BETWEEN 0.10000000 AND 0.50000000
    AND ceiling_cpm BETWEEN 0.10000000 AND 0.50000000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
