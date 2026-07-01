-- ============================================================
-- AdsGalaxy Pre-Launch Database Migration
-- File: 20260629_9999_launch_safe_migration.sql
-- Generated: 2026-06-29
-- Compatible: MariaDB 10.3+ (uses ADD COLUMN IF NOT EXISTS)
--
-- RECOMMENDED: Run via the Node.js runner instead of raw SQL,
-- because the runner uses INFORMATION_SCHEMA pre-checks and
-- works on any MariaDB version:
--   node scripts/run-launch-db-migration.js
--
-- SAFE GUARANTEES:
--   - Uses IF NOT EXISTS everywhere possible
--   - Never drops tables, columns, or rows
--   - INSERT IGNORE for all seed data
--   - Can be re-run without side effects
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- PART 1: TABLES NEVER CREATED BY ANY MIGRATION
-- Code references these tables but no migration creates them.
-- They are required for core features to function.
-- ============================================================

-- 1a. faqs
--     Migrations 0043 + 0045 INSERT INTO this table but no
--     migration creates it. The /api/faqs route reads from it.
CREATE TABLE IF NOT EXISTS `faqs` (
  `id`         INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `type`       VARCHAR(50)     NOT NULL DEFAULT 'general'
               COMMENT 'publisher | advertiser | referral | general',
  `question`   TEXT            NOT NULL,
  `answer`     TEXT            NOT NULL,
  `sort_order` INT             NOT NULL DEFAULT 0,
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
               ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_faqs_type` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1b. broadcast_deliveries
--     Required by the process-broadcast cron and publisher bot
--     earnings stats. Checked via tableExists() in
--     src/app/api/publisher/bots/route.ts.
--     Without this table the broadcast cron fails entirely.
CREATE TABLE IF NOT EXISTS `broadcast_deliveries` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `campaign_id`      INT             NOT NULL,
  `bot_id`           INT             NOT NULL,
  `user_id`          INT             NOT NULL,
  `chat_id`          BIGINT          NOT NULL,
  `cost`             DECIMAL(18,8)   NOT NULL DEFAULT '0.00000000',
  `publisher_reward` DECIMAL(18,8)   NOT NULL DEFAULT '0.00000000',
  `created_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bd_campaign_date` (`campaign_id`, `created_at`),
  KEY `idx_bd_bot`           (`bot_id`),
  KEY `idx_bd_user`          (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1c. campaign_views_audit
--     The update-views cron inserts a row on every view cycle.
--     Without this table the views cron throws on every run.
CREATE TABLE IF NOT EXISTS `campaign_views_audit` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `post_id`          INT             NOT NULL,
  `channel_id`       INT             NOT NULL,
  `total_views`      INT             NOT NULL DEFAULT 0,
  `last_views_count` INT             NOT NULL DEFAULT 0,
  `status`           VARCHAR(20)     NOT NULL DEFAULT 'valid',
  `created_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cva_post`             (`post_id`),
  KEY `idx_cva_channel_created`  (`channel_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- PART 2: MIGRATION 0046 — Private Channel Base Schema
-- Adds channel_type, invite_link_hash, view_tracking_status
-- to the channels table.
-- ============================================================

ALTER TABLE `channels`
  ADD COLUMN IF NOT EXISTS `channel_type`
    ENUM('public','private') NOT NULL DEFAULT 'public'
    AFTER `username`,
  ADD COLUMN IF NOT EXISTS `invite_link_hash`
    CHAR(64) NULL
    AFTER `channel_type`,
  ADD COLUMN IF NOT EXISTS `view_tracking_status`
    ENUM('available','limited','unavailable') NOT NULL DEFAULT 'available'
    AFTER `invite_link_hash`;

UPDATE `channels`
SET `channel_type`        = 'public',
    `view_tracking_status` = 'available'
WHERE `channel_type` IS NULL OR `channel_type` = '';

CREATE INDEX IF NOT EXISTS `idx_channels_type_status`
  ON `channels` (`channel_type`, `status`, `is_deleted`);

CREATE INDEX IF NOT EXISTS `idx_channels_invite_hash`
  ON `channels` (`invite_link_hash`);


-- ============================================================
-- PART 3: MIGRATION 0047 — Bot Webhooks
-- bots: webhook_last_update_at
-- bot_users: chat_id
-- new table: bot_webhook_updates
-- ============================================================

ALTER TABLE `bots`
  ADD COLUMN IF NOT EXISTS `webhook_last_update_at` DATETIME NULL;

ALTER TABLE `bots`
  ADD COLUMN IF NOT EXISTS `webhook_url` VARCHAR(500) NULL AFTER `bot_token`;

ALTER TABLE `bot_users`
  ADD COLUMN IF NOT EXISTS `chat_id` BIGINT NULL AFTER `telegram_id`;

CREATE TABLE IF NOT EXISTS `bot_webhook_updates` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bot_id`      INT             NOT NULL,
  `update_id`   BIGINT          NOT NULL,
  `received_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_bwu_bot_update` (`bot_id`, `update_id`),
  KEY `idx_bwu_received` (`received_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- NOTE: UNIQUE INDEX uniq_bot_users_bot_chat on bot_users(bot_id, chat_id)
-- is intentionally handled by the Node.js runner only, because it requires
-- a deduplication check before creation (safe when chat_id is all-NULL on
-- fresh install, but risky on a live DB with existing data).


-- ============================================================
-- PART 4: MIGRATION 0048 — Referral Settlement Tracking
-- referral_reward_ledger: settlement_run_id, settled_at
-- new tables: referral_settlement_runs, referral_settlement_history
-- ============================================================

ALTER TABLE `referral_reward_ledger`
  ADD COLUMN IF NOT EXISTS `settlement_run_id` INT NULL AFTER `status`,
  ADD COLUMN IF NOT EXISTS `settled_at` DATETIME NULL AFTER `settlement_run_id`;

CREATE TABLE IF NOT EXISTS `referral_settlement_runs` (
  `id`                  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `settlement_date`     DATE          NOT NULL,
  `settlement_type`     VARCHAR(30)   NOT NULL DEFAULT 'daily',
  `status`              VARCHAR(20)   NOT NULL DEFAULT 'pending',
  `verified_referrals`  INT           NOT NULL DEFAULT 0,
  `channel_conversions` INT           NOT NULL DEFAULT 0,
  `conversion_percent`  DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  `total_pending`       DECIMAL(18,8) NOT NULL DEFAULT '0.00000000',
  `total_paid`          DECIMAL(18,8) NOT NULL DEFAULT '0.00000000',
  `total_fraud`         DECIMAL(18,8) NOT NULL DEFAULT '0.00000000',
  `started_at`          DATETIME      NULL,
  `finished_at`         DATETIME      NULL,
  `metadata`            JSON          NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rsr_date_status` (`settlement_date`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `referral_settlement_history` (
  `id`                  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `settlement_run_id`   INT           NULL,
  `user_id`             INT           NOT NULL,
  `team_id`             INT           NULL,
  `settlement_date`     DATE          NOT NULL,
  `reward_label`        VARCHAR(100)  NULL,
  `reward_type`         VARCHAR(30)   NOT NULL,
  `amount`              DECIMAL(18,8) NOT NULL DEFAULT '0.00000000',
  `status`              VARCHAR(20)   NOT NULL DEFAULT 'paid',
  `reason`              VARCHAR(255)  NULL,
  `verified_referrals`  INT           NOT NULL DEFAULT 0,
  `channel_conversions` INT           NOT NULL DEFAULT 0,
  `conversion_percent`  DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  `metadata`            JSON          NULL,
  `notified_at`         DATETIME      NULL,
  `created_at`          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rsh_user_date` (`user_id`, `settlement_date`),
  KEY `idx_rsh_run`       (`settlement_run_id`),
  KEY `idx_rsh_status`    (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Settlement settings seed (referral_growth_settings)
INSERT IGNORE INTO `referral_growth_settings` (`key`, `value`, `description`) VALUES
  ('referral_settlement_fraud_min_conversion_pct', '3',
   'Minimum channel conversion % required to pass fraud check (0-100)'),
  ('referral_settlement_notify_publishers', '1',
   'Send settlement notifications to publishers after each run (0/1)');


-- ============================================================
-- PART 5: MIGRATION 0049 — Campaign Posting Mode
-- campaign_posts: posting_mode column + index
-- ============================================================

ALTER TABLE `campaign_posts`
  ADD COLUMN IF NOT EXISTS `posting_mode` VARCHAR(30) NOT NULL DEFAULT 'scheduled'
    AFTER `status`;

CREATE INDEX IF NOT EXISTS `idx_campaign_posts_posting_mode_slot`
  ON `campaign_posts` (`posting_mode`, `channel_id`, `posting_slot_date`, `posting_slot_time`);


-- ============================================================
-- PART 6: MIGRATION 0050 — Temporary Channel Check Unlock
-- Inserts settings rows for the admin-controlled channel check
-- page unlock feature.
-- ============================================================

INSERT IGNORE INTO `settings` (`key`, `value`, `description`) VALUES
  ('channel_check_unlocked_until',     '0',
   'Temporary channel-check page global unlock expiry as epoch milliseconds'),
  ('channel_check_last_unlocked_at',   '0',
   'Temporary channel-check page last unlock time as epoch milliseconds'),
  ('channel_check_duration_minutes',   '60',
   'Temporary channel-check page last configured unlock duration in minutes'),
  ('channel_check_unlocked_by_admin_id', '',
   'Admin id that last unlocked the temporary channel-check page');


-- ============================================================
-- PART 7: MIGRATION 0051 — Private Channel Tracking Accounts
-- channels: 7 tracking_account_* columns + index
-- These columns are checked via getChannelPrivacySchema()
-- in src/lib/channelPrivacy.ts before every private channel
-- database write.
-- ============================================================

ALTER TABLE `channels`
  ADD COLUMN IF NOT EXISTS `tracking_account_status`
    VARCHAR(30) NULL
    COMMENT 'pending_assignment | assigning | assigned | failed | unavailable'
    AFTER `view_tracking_status`,
  ADD COLUMN IF NOT EXISTS `tracking_account`
    VARCHAR(100) NULL
    COMMENT 'Username of the assigned MTProto tracking account'
    AFTER `tracking_account_status`,
  ADD COLUMN IF NOT EXISTS `tracking_account_member_status`
    VARCHAR(30) NULL
    COMMENT 'pending_join | joined | left | kicked'
    AFTER `tracking_account`,
  ADD COLUMN IF NOT EXISTS `tracking_account_assigned_at`
    DATETIME NULL
    AFTER `tracking_account_member_status`,
  ADD COLUMN IF NOT EXISTS `tracking_account_last_success_at`
    DATETIME NULL
    AFTER `tracking_account_assigned_at`,
  ADD COLUMN IF NOT EXISTS `tracking_account_last_failure_at`
    DATETIME NULL
    AFTER `tracking_account_last_success_at`,
  ADD COLUMN IF NOT EXISTS `tracking_account_failure_reason`
    VARCHAR(255) NULL
    AFTER `tracking_account_last_failure_at`;

CREATE INDEX IF NOT EXISTS `idx_channels_tracking_account`
  ON `channels` (`channel_type`, `tracking_account_status`, `tracking_account`, `is_deleted`);


-- ============================================================
-- PART 8: MIGRATION 0052 — Encrypted Private Invite Link
-- channels: private_invite_link_encrypted
--
-- CRITICAL: This is the PRIMARY BLOCKER for private channel
-- submission. Without this column, the channels POST handler
-- returns 503 PRIVATE_INVITE_STORAGE_UNAVAILABLE for every
-- private channel submission regardless of all other checks.
-- ============================================================

ALTER TABLE `channels`
  ADD COLUMN IF NOT EXISTS `private_invite_link_encrypted`
    TEXT NULL
    COMMENT 'AES-256-GCM encrypted private invite link for admin moderation access'
    AFTER `invite_link_hash`;


-- ============================================================
-- PART 9: MISSING COLUMNS — Never added by any migration
-- These columns are referenced directly in cron/API code but
-- no migration file in the entire chain adds them.
-- ============================================================

-- bot_users.last_broadcast_at
-- The process-broadcast cron reads this column to enforce
-- per-user broadcast cooldown:
--   WHERE (bu.last_broadcast_at IS NULL
--          OR bu.last_broadcast_at < NOW() - INTERVAL ? HOUR)
-- It also writes it on every delivery:
--   UPDATE bot_users SET last_broadcast_at = NOW() WHERE id = ?
-- Without this column: every user appears eligible on every run
-- (IS NULL check is always true), creating duplicate deliveries.
ALTER TABLE `bot_users`
  ADD COLUMN IF NOT EXISTS `last_broadcast_at` DATETIME NULL
    COMMENT 'Timestamp of last broadcast ad delivered to this user; cooldown enforcement';


-- ============================================================
-- PART 10: MISSING SETTINGS ROWS — Never seeded by any migration
-- The code reads these keys from the settings table but no
-- migration inserts them. On a fresh install the SELECT returns
-- NULL which the code handles, but default values may be wrong.
-- ============================================================

INSERT IGNORE INTO `settings` (`key`, `value`, `description`) VALUES
  -- Read in src/app/api/publisher/channels/route.ts line ~322
  -- Used to reject channel submissions below minimum subscriber count.
  -- Default 100 — adjust to your platform policy.
  ('min_subscribers', '100',
   'Minimum channel subscriber count required for approval'),

  -- Read in src/app/api/cron/process-broadcast/route.ts
  -- Determines what % of campaign cost becomes publisher reward.
  -- Default 70 — adjust to your revenue share policy.
  ('broadcast_ad_reward_percentage', '70',
   'Percentage of broadcast ad cost paid to bot publisher as reward (0-100)'),

  -- Updated by process-broadcast cron for throttle control.
  -- Must exist or the UPDATE silently affects 0 rows (cron runs
  -- un-throttled, risking duplicate broadcasts).
  ('last_broadcast_cron_run', '0',
   'Unix timestamp ms of last broadcast cron run; used for throttle guard');


-- ============================================================
-- PART 11: SAFETY INDEXES
-- Ensure these indexes exist even if their base columns were
-- added by earlier migrations that may have run without them.
-- ============================================================

CREATE INDEX IF NOT EXISTS `idx_bot_users_active_status`
  ON `bot_users` (`bot_id`, `is_active`, `status`);

CREATE INDEX IF NOT EXISTS `idx_bots_health_status`
  ON `bots` (`status`, `is_deleted`, `health_status`);


SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- END OF MIGRATION
-- After running, verify with:
--   node scripts/run-launch-db-migration.js --verify-only
-- Or manually:
--   DESCRIBE channels;
--   DESCRIBE bot_users;
--   SHOW CREATE TABLE broadcast_deliveries;
--   SHOW CREATE TABLE campaign_views_audit;
--   SELECT `key`,`value` FROM settings WHERE `key` IN
--     ('min_subscribers','broadcast_ad_reward_percentage',
--      'channel_check_unlocked_until','last_broadcast_cron_run');
-- ============================================================
