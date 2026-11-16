-- The campaign row retains the last approved creative while a replacement is reviewed.
-- Existing billing and spending rows are intentionally untouched.
CREATE TABLE IF NOT EXISTS campaign_creative_revisions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  campaign_id INT NOT NULL,
  revision_number INT UNSIGNED NOT NULL,
  creative_json LONGTEXT NOT NULL,
  teaser_variants_json LONGTEXT NULL,
  review_status VARCHAR(16) NOT NULL,
  submitted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  reviewed_at DATETIME(6) NULL,
  review_reason TEXT NULL,
  UNIQUE KEY uq_campaign_creative_revision (campaign_id, revision_number),
  KEY ix_campaign_creative_review (campaign_id, review_status),
  CONSTRAINT fk_campaign_creative_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
) ENGINE=InnoDB;

ALTER TABLE campaigns
  ADD COLUMN approved_creative_revision_id BIGINT UNSIGNED NULL,
  ADD COLUMN pending_creative_revision_id BIGINT UNSIGNED NULL,
  ADD COLUMN status_before_creative_review VARCHAR(40) NULL;

ALTER TABLE campaign_posts
  ADD COLUMN creative_revision_id BIGINT UNSIGNED NULL,
  ADD COLUMN approved_destination_url TEXT NULL,
  ADD COLUMN approved_destination_source VARCHAR(32) NULL,
  ADD COLUMN view_accepted_at DATETIME(6) NULL,
  ADD COLUMN billing_cutoff_at DATETIME(6) NULL;

-- NULL for historical clicks: their precise acceptance time was never stored.
-- New clicks receive a database-server timestamp only after a locked live-post check.
ALTER TABLE campaign_clicks
  ADD COLUMN accepted_at DATETIME(6) NULL,
  ADD KEY ix_campaign_click_acceptance (post_id, accepted_at, id);

ALTER TABLE teaser_placements
  ADD COLUMN creative_revision_id BIGINT UNSIGNED NULL,
  ADD COLUMN approved_destination_url TEXT NULL,
  ADD COLUMN approved_destination_source VARCHAR(32) NULL,
  ADD COLUMN billing_cutoff_at DATETIME(6) NULL;

ALTER TABLE broadcast_deliveries
  ADD COLUMN creative_revision_id BIGINT UNSIGNED NULL,
  ADD COLUMN approved_destination_url TEXT NULL,
  ADD COLUMN creative_snapshot_json LONGTEXT NULL,
  ADD COLUMN payout_snapshot_json LONGTEXT NULL,
  ADD COLUMN cleanup_status VARCHAR(20) NULL,
  ADD COLUMN cleanup_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN cleanup_next_retry_at DATETIME(6) NULL,
  ADD COLUMN cleanup_error VARCHAR(500) NULL,
  ADD COLUMN deleted_at DATETIME(6) NULL,
  ADD KEY ix_broadcast_cleanup (cleanup_status,cleanup_next_retry_at,id);

CREATE TABLE IF NOT EXISTS miniapp_creative_revisions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  campaign_id BIGINT UNSIGNED NOT NULL,
  revision_number INT UNSIGNED NOT NULL,
  creative_json LONGTEXT NOT NULL,
  review_status VARCHAR(16) NOT NULL,
  submitted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  reviewed_at DATETIME(6) NULL,
  review_reason TEXT NULL,
  UNIQUE KEY uq_miniapp_creative_revision (campaign_id, revision_number),
  KEY ix_miniapp_creative_review (campaign_id, review_status),
  CONSTRAINT fk_miniapp_creative_campaign FOREIGN KEY (campaign_id) REFERENCES miniapp_rewarded_campaigns(id)
) ENGINE=InnoDB;

ALTER TABLE miniapp_rewarded_campaigns
  ADD COLUMN approved_creative_revision_id BIGINT UNSIGNED NULL,
  ADD COLUMN pending_creative_revision_id BIGINT UNSIGNED NULL,
  ADD COLUMN status_before_creative_review VARCHAR(30) NULL,
  ADD COLUMN creative_review_started_at DATETIME(6) NULL;

ALTER TABLE miniapp_mediation_requests
  ADD COLUMN creative_revision_id BIGINT UNSIGNED NULL,
  ADD COLUMN approved_landing_url_snapshot TEXT NULL,
  ADD COLUMN advertiser_cpm_snapshot DECIMAL(18,8) NULL,
  ADD COLUMN cpm_mode_snapshot VARCHAR(20) NULL,
  ADD COLUMN fixed_publisher_cpm_snapshot DECIMAL(18,8) NULL;
