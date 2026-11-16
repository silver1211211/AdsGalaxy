-- Migration: 20261029_0430_ai_promotion_studio_remediation.sql
-- Additive remediation: adds creative_hash and unique index to ai_creative_memory if not present.

SET @exist := (SELECT COUNT(*) FROM information_schema.columns 
               WHERE table_schema = DATABASE() 
                 AND table_name = 'ai_creative_memory' 
                 AND column_name = 'creative_hash');

SET @sqlstmt := IF(@exist = 0, 
  'ALTER TABLE `ai_creative_memory` ADD COLUMN `creative_hash` VARCHAR(64) NOT NULL AFTER `campaign_id`, ADD UNIQUE KEY `uq_creative_hash` (`creative_hash`)', 
  'SELECT "Column creative_hash already exists"');

PREPARE stmt FROM @sqlstmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
