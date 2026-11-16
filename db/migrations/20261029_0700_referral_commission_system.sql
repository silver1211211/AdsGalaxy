-- Migration: Additive Referral Commission System (10% Real-Time Commission)
-- Author: Senior Systems Engineer
-- Target: AdsGalaxy Channels, Mini Apps, Bots
-- Safety: Additive only. Preserves all existing tables, columns, indexes, and historical ledger rows.

CREATE TABLE IF NOT EXISTS `referral_commission_ledger` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `referrer_user_id` INT NOT NULL,
  `referred_user_id` INT NOT NULL,
  `referral_id` INT NULL,
  `product_type` VARCHAR(32) NOT NULL, -- 'channel', 'miniapp', 'bot'
  `source_event_key` VARCHAR(191) NOT NULL,
  `monetized_earning_amount` DECIMAL(18,8) NOT NULL,
  `commission_amount` DECIMAL(18,8) NOT NULL,
  `commission_rate` DECIMAL(5,4) NOT NULL DEFAULT 0.1000,
  `status` VARCHAR(32) NOT NULL DEFAULT 'settled',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `settled_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_ref_comm_source_key` (`source_event_key`),
  KEY `idx_ref_comm_referrer` (`referrer_user_id`, `created_at`),
  KEY `idx_ref_comm_referred` (`referred_user_id`, `created_at`),
  KEY `idx_ref_comm_product` (`product_type`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
