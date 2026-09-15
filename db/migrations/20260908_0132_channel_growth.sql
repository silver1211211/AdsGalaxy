-- Additive Channel Growth foundation. No historical backfill or balance mutation.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS campaign_kind VARCHAR(32) NOT NULL DEFAULT 'channel' AFTER type,
  ADD COLUMN IF NOT EXISTS billing_model VARCHAR(16) NOT NULL DEFAULT 'cpm' AFTER campaign_kind,
  ADD COLUMN IF NOT EXISTS cost_per_subscriber DECIMAL(18,8) NULL AFTER cpc,
  ADD COLUMN IF NOT EXISTS destination_channel_id BIGINT NULL AFTER cost_per_subscriber,
  ADD COLUMN IF NOT EXISTS destination_chat_id BIGINT NULL AFTER destination_channel_id,
  ADD COLUMN IF NOT EXISTS growth_tracking_status VARCHAR(24) NULL AFTER destination_chat_id,
  ADD COLUMN IF NOT EXISTS growth_seed_allocated DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER growth_tracking_status,
  ADD COLUMN IF NOT EXISTS growth_seed_recovered DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER growth_seed_allocated,
  ADD INDEX IF NOT EXISTS idx_campaign_growth_delivery (campaign_kind,status,budget),
  ADD INDEX IF NOT EXISTS idx_campaign_growth_destination (destination_chat_id,status);

INSERT INTO settings (`key`,value,description) VALUES
 ('channel_growth_cps_min','0.25','Minimum Channel Growth cost per verified subscriber'),
 ('channel_growth_cps_recommended','0.56','Recommended Channel Growth cost per verified subscriber'),
 ('channel_growth_cps_max','5.00','Maximum Channel Growth cost per verified subscriber'),
 ('channel_growth_publisher_share','60','Maximum publisher share before quality adjustment'),
 ('channel_growth_platform_share','30','Ads Galaxy platform share'),
 ('channel_growth_reserve_share','10','Channel Growth reserve share'),
 ('channel_growth_seed_cap','10.00','Maximum Ads Galaxy-funded startup subsidy per growth campaign')
ON DUPLICATE KEY UPDATE value=value,description=VALUES(description);

CREATE TABLE IF NOT EXISTS channel_growth_invites (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 campaign_id INT NOT NULL, campaign_post_id INT NOT NULL,
 source_channel_id INT NOT NULL, source_publisher_id INT NOT NULL,
 destination_channel_id BIGINT NULL, destination_chat_id BIGINT NOT NULL,
 invite_link_hash CHAR(64) NOT NULL, invite_link_encrypted TEXT NOT NULL,
 status VARCHAR(24) NOT NULL DEFAULT 'active', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 revoked_at DATETIME NULL,
 UNIQUE KEY uq_growth_invite_post (campaign_post_id),
 UNIQUE KEY uq_growth_invite_hash (invite_link_hash),
 KEY idx_growth_invite_campaign (campaign_id,status),
 KEY idx_growth_invite_destination (destination_chat_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS channel_growth_membership_events (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 bot_id BIGINT NOT NULL, update_id BIGINT NOT NULL,
 invite_id BIGINT UNSIGNED NULL, campaign_id INT NULL, campaign_post_id INT NULL,
 destination_chat_id BIGINT NOT NULL, telegram_user_id BIGINT NOT NULL,
 is_bot TINYINT(1) NOT NULL DEFAULT 0, old_status VARCHAR(24) NULL, new_status VARCHAR(24) NULL,
 event_type VARCHAR(32) NOT NULL, event_at DATETIME NOT NULL,
 campaign_valid_at_event TINYINT(1) NOT NULL DEFAULT 0,
 processing_status VARCHAR(24) NOT NULL DEFAULT 'pending', nonbillable_reason VARCHAR(64) NULL,
 processed_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_growth_telegram_update (bot_id,update_id),
 KEY idx_growth_event_pending (processing_status,id),
 KEY idx_growth_event_campaign_user (campaign_id,telegram_user_id),
 KEY idx_growth_event_destination (destination_chat_id,event_at),
 KEY idx_growth_event_invite (invite_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS channel_growth_conversions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 campaign_id INT NOT NULL, destination_chat_id BIGINT NOT NULL, telegram_user_id BIGINT NOT NULL,
 invite_id BIGINT UNSIGNED NOT NULL, campaign_post_id INT NOT NULL,
 source_channel_id INT NOT NULL, source_publisher_id INT NOT NULL,
 membership_event_id BIGINT UNSIGNED NOT NULL, joined_at DATETIME NOT NULL,
 status VARCHAR(24) NOT NULL DEFAULT 'verified', fraud_status VARCHAR(24) NOT NULL DEFAULT 'clear',
 cost_per_subscriber DECIMAL(18,8) NOT NULL, advertiser_debit DECIMAL(18,8) NOT NULL DEFAULT 0,
 publisher_allocation DECIMAL(18,8) NOT NULL DEFAULT 0, platform_allocation DECIMAL(18,8) NOT NULL DEFAULT 0,
 reserve_allocation DECIMAL(18,8) NOT NULL DEFAULT 0, quality_adjustment DECIMAL(18,8) NOT NULL DEFAULT 0,
 seed_recovery DECIMAL(18,8) NOT NULL DEFAULT 0, debit_source_key VARCHAR(191) NOT NULL,
 billed_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_growth_billable_subscriber (campaign_id,destination_chat_id,telegram_user_id),
 UNIQUE KEY uq_growth_debit_source (debit_source_key),
 UNIQUE KEY uq_growth_membership_event (membership_event_id),
 KEY idx_growth_conversion_post (campaign_post_id),
 KEY idx_growth_conversion_publisher (source_publisher_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS channel_growth_seed_ledger (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 campaign_id INT NOT NULL, campaign_post_id INT NOT NULL, source_channel_id INT NOT NULL,
 source_publisher_id INT NOT NULL, source_key VARCHAR(191) NOT NULL,
 eligible_impressions INT UNSIGNED NOT NULL DEFAULT 0,
 publisher_credit DECIMAL(18,8) NOT NULL DEFAULT 0,
 status VARCHAR(24) NOT NULL DEFAULT 'pending', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 settled_at DATETIME NULL,
 UNIQUE KEY uq_growth_seed_source (source_key),
 KEY idx_growth_seed_campaign (campaign_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
