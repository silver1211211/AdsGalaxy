CREATE TABLE IF NOT EXISTS campaign_admin_isolation (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id INT NOT NULL,
  management_scope ENUM('main','silver') NOT NULL DEFAULT 'silver',
  pulled_at DATETIME NULL,
  pulled_by INT NULL,
  released_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_campaign_admin_isolation_campaign (campaign_id),
  KEY idx_campaign_admin_isolation_scope_campaign (management_scope,campaign_id),
  CONSTRAINT fk_campaign_admin_isolation_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_campaign_admin_isolation_admin FOREIGN KEY (pulled_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS silver_ad_exempt_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  reason VARCHAR(500) NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_silver_ad_exempt_user (user_id),
  KEY idx_silver_ad_exempt_active_user (active,user_id),
  CONSTRAINT fk_silver_ad_exempt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_silver_ad_exempt_created_by FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS silver_admin_access (
  admin_id INT NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  granted_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (admin_id),
  KEY idx_silver_admin_access_active (active,admin_id),
  CONSTRAINT fk_silver_admin_access_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
  CONSTRAINT fk_silver_admin_access_granter FOREIGN KEY (granted_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS silver_admin_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id INT NULL,
  action VARCHAR(80) NOT NULL,
  campaign_id INT NULL,
  target_user_id INT NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_silver_audit_campaign_created (campaign_id,created_at),
  KEY idx_silver_audit_target_created (target_user_id,created_at),
  KEY idx_silver_audit_action_created (action,created_at),
  CONSTRAINT fk_silver_audit_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE SET NULL,
  CONSTRAINT fk_silver_audit_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL,
  CONSTRAINT fk_silver_audit_user FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO settings (`key`,`value`,`description`)
VALUES ('silver_delivery_enabled','true','Master delivery guard for Silver-managed campaigns only')
ON DUPLICATE KEY UPDATE `key`=VALUES(`key`);
