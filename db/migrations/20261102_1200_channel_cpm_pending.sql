-- Pending CPM obligations are separate from settled publisher balances.
-- Install only after isolated validation - existing settled events are never backfilled.
-- Preserve all existing states and default while permitting future funded liabilities.
ALTER TABLE channel_unified_settlement_events MODIFY COLUMN status ENUM('settled','reversed','failed','funded_pending') NOT NULL DEFAULT 'settled';

CREATE TABLE IF NOT EXISTS channel_cpm_window_policies (
 campaign_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 window_seconds INT UNSIGNED NOT NULL, grace_seconds INT UNSIGNED NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS channel_cpm_settlement_windows (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 campaign_id BIGINT UNSIGNED NOT NULL, start_epoch BIGINT UNSIGNED NOT NULL,
 end_epoch BIGINT UNSIGNED NOT NULL, finalizable_epoch BIGINT UNSIGNED NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'pending',
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_cpm_campaign_window (campaign_id,start_epoch), KEY idx_cpm_window_due (status,finalizable_epoch,id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS channel_cpm_pending_allocations (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 window_id BIGINT UNSIGNED NOT NULL, campaign_id BIGINT UNSIGNED NOT NULL,
 advertiser_id BIGINT UNSIGNED NOT NULL, publisher_id BIGINT UNSIGNED NOT NULL,
 channel_id BIGINT UNSIGNED NOT NULL, post_id BIGINT UNSIGNED NOT NULL,
 canonical_event_id BIGINT UNSIGNED NOT NULL, source_key VARCHAR(191) NOT NULL,
 billable_views BIGINT UNSIGNED NOT NULL, unit_price DECIMAL(20,8) NOT NULL,
 advertiser_debit DECIMAL(20,8) NOT NULL, neutral_entitlement DECIMAL(20,8) NOT NULL,
 platform_revenue DECIMAL(20,8) NOT NULL, reserve_contribution DECIMAL(20,8) NOT NULL,
 event_epoch BIGINT UNSIGNED NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'pending',
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_cpm_pending_event (canonical_event_id), UNIQUE KEY uq_cpm_pending_source (source_key),
 KEY idx_cpm_pending_window (window_id,status,publisher_id,id),
 CONSTRAINT fk_cpm_pending_window FOREIGN KEY (window_id) REFERENCES channel_cpm_settlement_windows(id)
) ENGINE=InnoDB;
