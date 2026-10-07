-- Cross-product lifecycle notifications, Telegram access transitions, and
-- persistent publisher schedule-slot consumption. Additive and idempotent.

UPDATE campaign_analytics_adjustments
SET adjustment_mode='additive'
WHERE campaign_id=64 AND metric='clicks'
  AND reason='historical_click_tracking_outage_recovery'
  AND quantity=200 AND financial_effect=0;

CREATE TABLE IF NOT EXISTS platform_notification_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_key VARCHAR(191) NOT NULL,
  user_id INT NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id VARCHAR(80) NOT NULL,
  message_html TEXT NOT NULL,
  metadata JSON NULL,
  status ENUM('pending','processing','sent','failed') NOT NULL DEFAULT 'pending',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error VARCHAR(500) NULL,
  sent_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY(id),
  UNIQUE KEY uq_platform_notification_event(event_key),
  KEY idx_platform_notification_dispatch(status,next_attempt_at,id),
  KEY idx_platform_notification_user(user_id,created_at),
  CONSTRAINT fk_platform_notification_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS advertiser_balance_notification_state (
  user_id INT NOT NULL,
  below_threshold TINYINT(1) NOT NULL DEFAULT 0,
  threshold_cycle INT UNSIGNED NOT NULL DEFAULT 0,
  last_balance DECIMAL(18,8) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id),
  CONSTRAINT fk_balance_notification_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS channel_schedule_slot_claims (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  channel_id INT NOT NULL,
  slot_date DATE NOT NULL,
  slot_time TIME NOT NULL,
  campaign_id INT NOT NULL,
  campaign_post_id INT NULL,
  delivery_generation INT NOT NULL,
  claim_type ENUM('scheduled','emergency_fill','emergency_replace') NOT NULL,
  released_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(id),
  UNIQUE KEY uq_channel_schedule_slot(channel_id,slot_date,slot_time),
  KEY idx_channel_slot_campaign(campaign_id,slot_date),
  CONSTRAINT fk_channel_slot_channel FOREIGN KEY(channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  CONSTRAINT fk_channel_slot_campaign FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_channel_slot_post FOREIGN KEY(campaign_post_id) REFERENCES campaign_posts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS telegram_access_state VARCHAR(32) NULL AFTER health_status,
  ADD COLUMN IF NOT EXISTS telegram_access_version INT UNSIGNED NOT NULL DEFAULT 0 AFTER telegram_access_state,
  ADD COLUMN IF NOT EXISTS telegram_access_previous_status VARCHAR(32) NULL AFTER telegram_access_version;

ALTER TABLE channels ADD COLUMN IF NOT EXISTS notification_state_version INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS notification_state_version INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE miniapps ADD COLUMN IF NOT EXISTS notification_state_version INT UNSIGNED NOT NULL DEFAULT 0;
