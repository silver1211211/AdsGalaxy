-- Migration: 20261029_0159_ai_promotion_studio_foundation.sql
-- AdsGalaxy Official AI Promotion Studio: Additive Schema & Creative Memory
-- Strictly separated from financial settlement & live advertiser balances.

-- 1. Persistent Creative Memory Table (with SHA-256 unique deduplication)
CREATE TABLE IF NOT EXISTS `ai_creative_memory` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `campaign_id` INT(11) NULL,
  `creative_hash` VARCHAR(64) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `caption` TEXT NOT NULL,
  `image_url` VARCHAR(1024) NOT NULL,
  `destination_link` VARCHAR(2048) NOT NULL,
  `categories` JSON NOT NULL,
  `strategy_tag` VARCHAR(64) NOT NULL,
  `concept_description` TEXT NULL,
  `total_impressions` INT(11) NOT NULL DEFAULT 0,
  `valid_clicks` INT(11) NOT NULL DEFAULT 0,
  `total_spend` DECIMAL(20,8) NOT NULL DEFAULT 0.00000000,
  `ctr` DECIMAL(8,4) NOT NULL DEFAULT 0.0000,
  `performance_rating` ENUM('pending', 'testing', 'winner', 'average', 'loser', 'retired') NOT NULL DEFAULT 'testing',
  `reuse_count` INT(11) NOT NULL DEFAULT 0,
  `parent_creative_id` INT(11) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_creative_hash` (`creative_hash`),
  KEY `idx_perf_categories` (`performance_rating`, `created_at`),
  KEY `idx_campaign` (`campaign_id`),
  KEY `idx_parent` (`parent_creative_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Daily AI Generation Telemetry & Cost Control
CREATE TABLE IF NOT EXISTS `ai_studio_generation_logs` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `generation_type` ENUM('text', 'image', 'variation') NOT NULL,
  `model_id` VARCHAR(128) NOT NULL,
  `category` VARCHAR(64) NOT NULL,
  `prompt_tokens` INT(11) NULL DEFAULT 0,
  `response_tokens` INT(11) NULL DEFAULT 0,
  `cost_estimate` DECIMAL(10,6) NOT NULL DEFAULT 0.000000,
  `status` ENUM('success', 'failed') NOT NULL,
  `error_message` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_date_type` (`created_at`, `generation_type`),
  KEY `idx_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Default Configuration in settings table (Disabled by default, no hardcoded user ID)
INSERT IGNORE INTO `settings` (`key`, `value`, `description`) VALUES
('ai_studio_enabled', '0', 'Global toggle for AdsGalaxy AI Promotion Studio (0=disabled, 1=enabled)'),
('ai_studio_advertiser_user_id', '', 'Explicitly configured user ID representing official AdsGalaxy advertising identity'),
('ai_studio_text_model', 'gemini-3.5-flash-lite', 'Gemini text model identifier for copy generation'),
('ai_studio_image_model', 'gemini-3.1-flash-lite-image', 'Image model identifier for promotional banner generation'),
('ai_studio_daily_gen_limit', '50', 'Maximum AI creative generations allowed per 24 hours'),
('ai_studio_cpc_rate', '50.00000000', 'Fixed internal CPC rate per 1,000 clicks (0.05 USDT/click)'),
('ai_studio_min_eval_impressions', '1000', 'Minimum impressions required before 48h CTR evaluation'),
('ai_studio_min_ctr_threshold', '1.20', 'Minimum CTR required to prevent creative replacement'),
('ai_studio_winner_ctr_threshold', '2.00', 'CTR threshold qualifying creative for Creative Memory reuse'),
('ai_studio_master_pause', '0', 'Emergency master pause for all AI Promotion Studio creation'),
('ai_studio_destination_url', '', 'Approved destination link for AI promotional CTA buttons'),
('ai_studio_button_text', 'Advertise on AdsGalaxy', 'Default CTA button label for generated campaigns'),
('ai_studio_category_targets', '{"crypto":{"target":5,"budget":25,"enabled":true},"finance":{"target":3,"budget":15,"enabled":true},"tech":{"target":4,"budget":20,"enabled":true}}', 'Configured active campaign targets and budgets per category');
