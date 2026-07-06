-- Phase 6F: production-scale query indexes.
-- Additive only. Does not change billing, settlement, payout, CPM, or reporting formulas.

SET @has_idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests'
    AND INDEX_NAME = 'idx_miniapp_mediation_app_network_created'
);
SET @sql = IF(@has_idx = 0,
  'CREATE INDEX idx_miniapp_mediation_app_network_created ON miniapp_mediation_requests (miniapp_id, selected_network, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_mediation_requests'
    AND INDEX_NAME = 'idx_miniapp_mediation_user_created'
);
SET @sql = IF(@has_idx = 0,
  'CREATE INDEX idx_miniapp_mediation_user_created ON miniapp_mediation_requests (telegram_user_id, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ad_click_attribution'
    AND INDEX_NAME = 'idx_ad_click_attr_request_type_created'
);
SET @sql = IF(@has_idx = 0,
  'CREATE INDEX idx_ad_click_attr_request_type_created ON ad_click_attribution (request_id, campaign_type, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaign_clicks'
    AND INDEX_NAME = 'idx_campaign_clicks_campaign_created'
);
SET @sql = IF(@has_idx = 0,
  'CREATE INDEX idx_campaign_clicks_campaign_created ON campaign_clicks (campaign_id, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaign_clicks'
    AND INDEX_NAME = 'idx_campaign_clicks_post_created'
);
SET @sql = IF(@has_idx = 0,
  'CREATE INDEX idx_campaign_clicks_post_created ON campaign_clicks (post_id, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'broadcast_deliveries'
    AND INDEX_NAME = 'idx_broadcast_deliveries_campaign_status_created'
);
SET @sql = IF(@has_idx = 0,
  'CREATE INDEX idx_broadcast_deliveries_campaign_status_created ON broadcast_deliveries (campaign_id, status, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_internal_ad_impressions'
    AND INDEX_NAME = 'idx_miniapp_internal_impressions_campaign_created'
);
SET @sql = IF(@has_idx = 0,
  'CREATE INDEX idx_miniapp_internal_impressions_campaign_created ON miniapp_internal_ad_impressions (campaign_id, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_internal_ad_impressions'
    AND INDEX_NAME = 'idx_miniapp_internal_impressions_app_created'
);
SET @sql = IF(@has_idx = 0,
  'CREATE INDEX idx_miniapp_internal_impressions_app_created ON miniapp_internal_ad_impressions (miniapp_id, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'deposits'
    AND INDEX_NAME = 'idx_deposits_user_created'
);
SET @sql = IF(@has_idx = 0,
  'CREATE INDEX idx_deposits_user_created ON deposits (user_id, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'withdrawals'
    AND INDEX_NAME = 'idx_withdrawals_user_status_created'
);
SET @sql = IF(@has_idx = 0,
  'CREATE INDEX idx_withdrawals_user_status_created ON withdrawals (user_id, status, created_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
