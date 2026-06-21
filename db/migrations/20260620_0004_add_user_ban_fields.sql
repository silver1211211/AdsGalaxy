-- Minimal user-ban support for admin fraud review.
-- Safe to re-run on MariaDB; MySQL installs should check INFORMATION_SCHEMA first.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_banned TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS banned_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS ban_reason VARCHAR(255) NULL;

CREATE INDEX IF NOT EXISTS idx_users_is_banned
  ON users (is_banned);
