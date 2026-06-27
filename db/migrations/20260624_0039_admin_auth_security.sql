-- Final launch blockers: admin password hashes and server-side admin sessions.

ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NULL AFTER password,
  ADD COLUMN IF NOT EXISTS password_migrated_at DATETIME NULL AFTER password_hash;

-- Migrate the seeded default admin account without application-side plaintext comparison.
UPDATE admins
SET password_hash = '$2b$12$OeVbk9w3XYEloyRXEUj7cebHFDxlJ8XKbT8J1OXIAWK/YONQ7XXWa',
    password = '[migrated]',
    password_migrated_at = NOW()
WHERE username = 'admin'
  AND (password_hash IS NULL OR password_hash = '');

-- Remove remaining legacy plaintext password values from storage. These accounts require password reset.
UPDATE admins
SET password = '[reset_required]'
WHERE password IS NOT NULL
  AND password NOT IN ('[migrated]', '[reset_required]');

CREATE TABLE IF NOT EXISTS admin_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_admin_session_token_hash (token_hash),
  KEY idx_admin_sessions_admin (admin_id, revoked_at, expires_at),
  KEY idx_admin_sessions_expiry (expires_at, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
