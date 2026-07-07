-- Phase 8A support-account MTProto messaging foundation.
-- Queue-first and idempotent: no message is sent by this migration.

CREATE TABLE IF NOT EXISTS support_message_templates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_type VARCHAR(80) NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  subject VARCHAR(160) NULL,
  body TEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_support_template_type_version (message_type, version),
  KEY idx_support_templates_active (message_type, is_active, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_message_queue (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT NULL,
  telegram_user_id VARCHAR(64) NOT NULL,
  username VARCHAR(255) NULL,
  first_name VARCHAR(255) NULL,
  message_type VARCHAR(80) NOT NULL,
  template_version INT UNSIGNED NOT NULL DEFAULT 1,
  rendered_message TEXT NULL,
  status ENUM('queued','sending','sent','failed','retry_scheduled','permanently_failed','paused','dry_run') NOT NULL DEFAULT 'queued',
  queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  failed_at DATETIME NULL,
  retry_count INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error_code VARCHAR(80) NULL,
  last_error_message VARCHAR(500) NULL,
  sender_account VARCHAR(120) NULL,
  provider VARCHAR(40) NOT NULL DEFAULT 'mtproto',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_support_message_user_type (telegram_user_id, message_type),
  KEY idx_support_message_queue_status_attempt (status, next_attempt_at, id),
  KEY idx_support_message_queue_type_status (message_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_message_delivery_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  queue_id BIGINT UNSIGNED NULL,
  telegram_user_id VARCHAR(64) NULL,
  username VARCHAR(255) NULL,
  message_type VARCHAR(80) NULL,
  template_version INT UNSIGNED NULL,
  status VARCHAR(40) NOT NULL,
  dry_run TINYINT(1) NOT NULL DEFAULT 0,
  provider VARCHAR(40) NOT NULL DEFAULT 'mtproto',
  sender_account VARCHAR(120) NULL,
  error_code VARCHAR(80) NULL,
  error_message VARCHAR(500) NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_support_delivery_queue (queue_id, created_at),
  KEY idx_support_delivery_status (status, created_at),
  KEY idx_support_delivery_type (message_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_message_backfill_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_type VARCHAR(80) NOT NULL,
  status ENUM('running','paused','cancelled','completed','failed') NOT NULL DEFAULT 'running',
  total_eligible INT UNSIGNED NOT NULL DEFAULT 0,
  queued_count INT UNSIGNED NOT NULL DEFAULT 0,
  skip_permanently_failed TINYINT(1) NOT NULL DEFAULT 1,
  batch_size INT UNSIGNED NOT NULL DEFAULT 100,
  last_user_id INT UNSIGNED NOT NULL DEFAULT 0,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paused_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  completed_at DATETIME NULL,
  last_error_code VARCHAR(80) NULL,
  last_error_message VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_support_backfill_status (status, message_type, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_message_settings (
  `key` VARCHAR(120) NOT NULL,
  value TEXT NULL,
  description VARCHAR(255) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO support_message_settings (`key`, value, description) VALUES
  ('support_messages_paused', '1', 'Global pause switch. 1 pauses all support-account sends.'),
  ('support_messages_dry_run', '0', 'When 1, cron renders/logs messages without MTProto sending.'),
  ('support_messages_max_per_hour', '60', 'Maximum real support-account sends per hour.'),
  ('support_messages_max_per_day', '300', 'Maximum real support-account sends per day.')
ON DUPLICATE KEY UPDATE `key` = VALUES(`key`);

INSERT INTO support_message_templates (message_type, version, subject, body, is_active) VALUES
  ('publisher_welcome', 1, 'Publisher welcome',
'Hi {{first_name}}, welcome to AdsGalaxy.
I noticed you just created your publisher account.
You can monetize your Telegram channels, bots, and Mini Apps with AdsGalaxy. If you want to test it first, you can connect one or two of your best channels and watch how the earnings perform before adding more.
Quick guides:
- Monetize Channel: {{channel_docs_link}}
- Monetize Bot: {{bot_docs_link}}
- Monetize Mini App: {{miniapp_docs_link}}
Reply here if you need any help.', 1),
  ('advertiser_onboarding', 1, 'Advertiser onboarding',
'Hi {{first_name}}, welcome to AdsGalaxy Advertiser.
I noticed you activated advertiser mode.
You can run ads inside Telegram Mini Apps, channels, and bots. The minimum campaign budget starts from $10, so you can test with a small budget first and scale when you see results.
Quick guides:
- Run Mini App Ads: {{miniapp_ads_docs_link}}
- Run Channel Ads: {{channel_ads_docs_link}}
- Run Bot Ads: {{bot_ads_docs_link}}
Reply here if you need any help setting up your first campaign.', 1)
ON DUPLICATE KEY UPDATE
  subject = VALUES(subject),
  body = VALUES(body),
  is_active = VALUES(is_active);
