CREATE TABLE IF NOT EXISTS platform_broadcasts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NULL,
  title_bold TINYINT(1) NOT NULL DEFAULT 0,
  message_text TEXT NOT NULL,
  message_html TEXT NOT NULL,
  image_path VARCHAR(500) NULL,
  button_text VARCHAR(80) NULL,
  button_url VARCHAR(1000) NULL,
  target_type VARCHAR(32) NOT NULL DEFAULT 'all_users',
  status ENUM('draft','queued','running','pausing','paused','completed','cancelled','failed') NOT NULL DEFAULT 'draft',
  created_by_admin_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  queued_at DATETIME NULL, started_at DATETIME NULL, completed_at DATETIME NULL,
  paused_at DATETIME NULL, cancelled_at DATETIME NULL, last_recipient_scan_at DATETIME NULL,
  quiet_since DATETIME NULL, quiet_scan_count INT UNSIGNED NOT NULL DEFAULT 0,
  discovered_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  sent_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  failed_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  blocked_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  INDEX idx_platform_broadcast_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_broadcast_recipients (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  broadcast_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  telegram_id VARCHAR(64) NOT NULL,
  status ENUM('queued','sending','sent','failed','blocked','cancelled') NOT NULL DEFAULT 'queued',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sending_at DATETIME NULL, lease_expires_at DATETIME NULL, sent_at DATETIME NULL, failed_at DATETIME NULL,
  next_retry_at DATETIME NULL, last_error_code VARCHAR(80) NULL, last_error_category VARCHAR(40) NULL,
  telegram_message_id BIGINT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_platform_broadcast_user (broadcast_id, user_id),
  UNIQUE KEY uq_platform_broadcast_telegram (broadcast_id, telegram_id),
  INDEX idx_platform_recipient_claim (broadcast_id, status, next_retry_at, id),
  CONSTRAINT fk_platform_recipient_broadcast FOREIGN KEY (broadcast_id) REFERENCES platform_broadcasts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_broadcast_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  broadcast_id BIGINT UNSIGNED NOT NULL,
  admin_id BIGINT UNSIGNED NULL,
  action VARCHAR(60) NOT NULL,
  details JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), INDEX idx_platform_broadcast_audit (broadcast_id, created_at),
  CONSTRAINT fk_platform_audit_broadcast FOREIGN KEY (broadcast_id) REFERENCES platform_broadcasts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
