-- Additive Phase 1 foundation. This table is shadow-only until explicitly enabled.
CREATE TABLE IF NOT EXISTS channel_allocation_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id CHAR(36) NOT NULL,
  source_key VARCHAR(191) NOT NULL,
  source_type ENUM('view','click','reversal','adjustment') NOT NULL,
  source_record_id BIGINT UNSIGNED NULL,
  campaign_id INT NULL,
  post_id INT NULL,
  channel_id INT NULL,
  advertiser_id INT NULL,
  publisher_id INT NULL,
  billable_units BIGINT NOT NULL DEFAULT 0,
  unit_price DECIMAL(24,8) NOT NULL DEFAULT 0,
  advertiser_debit DECIMAL(24,8) NOT NULL DEFAULT 0,
  publisher_allocation DECIMAL(24,8) NOT NULL DEFAULT 0,
  platform_allocation DECIMAL(24,8) NOT NULL DEFAULT 0,
  reserve_allocation DECIMAL(24,8) NOT NULL DEFAULT 0,
  quality_adjustment DECIMAL(24,8) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  policy_version VARCHAR(64) NOT NULL,
  occurred_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  settled_at DATETIME(6) NULL,
  reversal_of_event_id CHAR(36) NULL,
  fraud_status ENUM('clear','suspected','confirmed','reversed') NOT NULL DEFAULT 'clear',
  payload_hash CHAR(64) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_channel_allocation_event_id (event_id),
  UNIQUE KEY uniq_channel_allocation_source_key (source_key),
  KEY idx_channel_allocation_campaign_time (campaign_id, occurred_at),
  KEY idx_channel_allocation_post_time (post_id, occurred_at),
  KEY idx_channel_allocation_channel_time (channel_id, occurred_at),
  KEY idx_channel_allocation_publisher_time (publisher_id, occurred_at),
  KEY idx_channel_allocation_policy_time (policy_version, occurred_at),
  KEY idx_channel_allocation_reversal (reversal_of_event_id),
  CONSTRAINT chk_channel_allocation_reversal_link CHECK (
    (source_type = 'reversal' AND reversal_of_event_id IS NOT NULL AND reversal_of_event_id <> event_id)
    OR (source_type <> 'reversal' AND reversal_of_event_id IS NULL)
  ),
  CONSTRAINT fk_channel_allocation_reversal_event
    FOREIGN KEY (reversal_of_event_id) REFERENCES channel_allocation_ledger(event_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_channel_allocation_units CHECK (billable_units >= 0),
  CONSTRAINT chk_channel_allocation_amounts CHECK (
    advertiser_debit >= 0 AND publisher_allocation >= 0 AND
    platform_allocation >= 0 AND reserve_allocation >= 0 AND quality_adjustment >= 0
  ),
  CONSTRAINT chk_channel_allocation_invariant CHECK (
    advertiser_debit = publisher_allocation + platform_allocation + reserve_allocation + quality_adjustment
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
