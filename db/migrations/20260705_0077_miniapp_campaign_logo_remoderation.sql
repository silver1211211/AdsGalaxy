-- Additive creative and re-moderation metadata. Financial and analytics data are unchanged.
SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_rewarded_campaigns' AND COLUMN_NAME = 'logo_url') = 0, 'ALTER TABLE miniapp_rewarded_campaigns ADD COLUMN logo_url TEXT NULL AFTER image_url', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_rewarded_campaigns' AND COLUMN_NAME = 'requires_re_moderation') = 0, 'ALTER TABLE miniapp_rewarded_campaigns ADD COLUMN requires_re_moderation TINYINT(1) NOT NULL DEFAULT 0 AFTER creative_review_status', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_rewarded_campaigns' AND COLUMN_NAME = 'previously_approved_at') = 0, 'ALTER TABLE miniapp_rewarded_campaigns ADD COLUMN previously_approved_at DATETIME NULL AFTER requires_re_moderation', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaigns' AND COLUMN_NAME = 'rejection_reason') = 0, 'ALTER TABLE campaigns ADD COLUMN rejection_reason TEXT NULL AFTER status', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
