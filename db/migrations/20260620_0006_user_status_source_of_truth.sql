-- Central user status for ban/unban.
-- status is the source of truth; is_banned is legacy compatibility only.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

UPDATE users
SET status = 'banned'
WHERE COALESCE(is_banned, 0) = 1;

UPDATE users
SET status = 'active'
WHERE status IS NULL OR status = '';

CREATE INDEX IF NOT EXISTS idx_users_status
  ON users (status);
