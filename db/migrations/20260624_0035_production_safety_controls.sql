-- Phase 18: production safety controls, admin permissions, alerts, and launch readiness.
-- Additive only. Runtime behavior is controlled by settings and status fields.

ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS role VARCHAR(40) NOT NULL DEFAULT 'super_admin' AFTER password;

CREATE TABLE IF NOT EXISTS admin_alerts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  alert_type VARCHAR(80) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'medium',
  title VARCHAR(160) NOT NULL,
  details TEXT NULL,
  entity_type VARCHAR(50) NULL,
  entity_id BIGINT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_admin_alerts_status_severity (status, severity, created_at),
  KEY idx_admin_alerts_type_created (alert_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO settings (`key`, value, description) VALUES
  ('platform_active', '1', 'Global platform active switch'),
  ('platform_maintenance_mode', '0', 'Allow login/viewing but block new writes for user operations'),
  ('platform_read_only', '0', 'Block user write operations while keeping reads available'),
  ('platform_emergency_stop', '0', 'Emergency stop for ad serving, scheduler, broadcasts, and SDK requests'),
  ('platform_maintenance_message', 'AdsGalaxy is in maintenance mode. You can view data, but new actions are temporarily paused.', 'Message shown to users during maintenance/read-only modes'),
  ('network_adsgalaxy_internal_enabled', '1', 'Enable AdsGalaxy internal Mini App ads'),
  ('network_adsgram_enabled', '1', 'Enable AdsGram network mediation'),
  ('network_monetag_enabled', '1', 'Enable Monetag network mediation'),
  ('network_richads_enabled', '1', 'Enable RichAds network mediation'),
  ('network_adexium_enabled', '1', 'Enable AdExium network mediation'),
  ('network_gigapub_enabled', '1', 'Enable GigaPub network mediation'),
  ('withdrawals_paused', '0', 'Pause all withdrawal submissions'),
  ('withdrawals_pause_reason', '', 'Reason displayed to users when withdrawals are paused'),
  ('withdrawal_method_BEP20_enabled', '1', 'Enable BEP20 withdrawal submissions'),
  ('withdrawal_method_TRC20_enabled', '1', 'Enable TRC20 withdrawal submissions'),
  ('withdrawal_method_TON_enabled', '1', 'Enable TON withdrawal submissions')
ON DUPLICATE KEY UPDATE description = VALUES(description);
