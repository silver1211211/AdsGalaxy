-- Phase 13D: admin-visible system, channel posting, health, and broadcast summary logs.
-- Additive only. Does not modify CPM, payout, withdrawal, referral, Mini App mediation, SDK, or campaign creation flows.

CREATE TABLE IF NOT EXISTS system_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  log_type VARCHAR(60) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'success',
  title VARCHAR(160) NOT NULL,
  summary TEXT NULL,
  period_start DATETIME NULL,
  period_end DATETIME NULL,
  slot_date DATE NULL,
  slot_time TIME NULL,
  attempted_count INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  auto_paused_count INT NOT NULL DEFAULT 0,
  inactive_users_count INT NOT NULL DEFAULT 0,
  paused_bots_count INT NOT NULL DEFAULT 0,
  failed_bots_count INT NOT NULL DEFAULT 0,
  failure_reasons JSON NULL,
  affected_entities JSON NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_system_logs_type_period (log_type, period_start),
  KEY idx_system_logs_type_status_created (log_type, status, created_at),
  KEY idx_system_logs_period (period_start, period_end),
  KEY idx_system_logs_slot (slot_date, slot_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO settings (`key`, value) VALUES
  ('system_log_retention_days', '60'),
  ('last_system_logs_cleanup_run', '0');
