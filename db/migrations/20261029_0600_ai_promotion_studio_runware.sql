-- Migration: 20261029_0600_ai_promotion_studio_runware.sql
-- AdsGalaxy Official AI Promotion Studio: Runware Provider Integration & Cost Telemetry
-- Safe, additive migration. Reversible. Does not mutate live user balances or campaign metrics.

-- 1. Additive Columns to ai_creative_memory for Runware Model and Actual Cost Tracking
SET @dbname = DATABASE();

-- Add text_model column
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'ai_creative_memory' AND COLUMN_NAME = 'text_model') > 0,
  'SELECT 1',
  'ALTER TABLE `ai_creative_memory` ADD COLUMN `text_model` VARCHAR(128) NULL AFTER `strategy_tag`'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add image_model column
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'ai_creative_memory' AND COLUMN_NAME = 'image_model') > 0,
  'SELECT 1',
  'ALTER TABLE `ai_creative_memory` ADD COLUMN `image_model` VARCHAR(128) NULL AFTER `text_model`'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add button_text column
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'ai_creative_memory' AND COLUMN_NAME = 'button_text') > 0,
  'SELECT 1',
  'ALTER TABLE `ai_creative_memory` ADD COLUMN `button_text` VARCHAR(64) NULL AFTER `destination_link`'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add visual_prompt column
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'ai_creative_memory' AND COLUMN_NAME = 'visual_prompt') > 0,
  'SELECT 1',
  'ALTER TABLE `ai_creative_memory` ADD COLUMN `visual_prompt` TEXT NULL AFTER `concept_description`'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add cost_text column
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'ai_creative_memory' AND COLUMN_NAME = 'cost_text') > 0,
  'SELECT 1',
  'ALTER TABLE `ai_creative_memory` ADD COLUMN `cost_text` DECIMAL(10,6) NOT NULL DEFAULT 0.000000 AFTER `total_spend`'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add cost_image column
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'ai_creative_memory' AND COLUMN_NAME = 'cost_image') > 0,
  'SELECT 1',
  'ALTER TABLE `ai_creative_memory` ADD COLUMN `cost_image` DECIMAL(10,6) NOT NULL DEFAULT 0.000000 AFTER `cost_text`'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add total_cost column
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'ai_creative_memory' AND COLUMN_NAME = 'total_cost') > 0,
  'SELECT 1',
  'ALTER TABLE `ai_creative_memory` ADD COLUMN `total_cost` DECIMAL(10,6) NOT NULL DEFAULT 0.000000 AFTER `cost_image`'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add review_status column
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'ai_creative_memory' AND COLUMN_NAME = 'review_status') > 0,
  'SELECT 1',
  'ALTER TABLE `ai_creative_memory` ADD COLUMN `review_status` ENUM(\'preview\', \'tested\', \'approved\', \'rejected\', \'published\', \'reused\') NOT NULL DEFAULT \'tested\' AFTER `performance_rating`'
));
PREPARE stmt FROM @preparedStatement;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Additive Settings Rows for Runware AI & Cost Budget Limits
INSERT IGNORE INTO `settings` (`key`, `value`, `description`) VALUES
('ai_studio_provider', 'runware', 'AI generation provider (runware)'),
('ai_studio_daily_cost_limit', '5.00', 'Maximum daily Runware API generation cost allowed ($5.00)'),
('ai_studio_monthly_cost_limit', '50.00', 'Maximum monthly Runware API generation cost allowed ($50.00)');

-- Update default models in settings to Runware GLM-5.3 Flash and Z-Image Turbo
UPDATE `settings` SET `value` = 'zai:glm@5.3-flash' WHERE `key` = 'ai_studio_text_model' AND `value` = 'gemini-3.5-flash-lite';
UPDATE `settings` SET `value` = 'runware:z-image@turbo' WHERE `key` = 'ai_studio_image_model' AND `value` = 'gemini-3.1-flash-lite-image';
