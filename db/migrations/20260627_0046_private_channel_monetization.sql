-- Private channel monetization support.
-- Existing channels remain public by default. Raw invite links are never stored.

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS channel_type ENUM('public', 'private') NOT NULL DEFAULT 'public' AFTER username,
  ADD COLUMN IF NOT EXISTS invite_link_hash CHAR(64) NULL AFTER channel_type,
  ADD COLUMN IF NOT EXISTS view_tracking_status ENUM('available', 'limited', 'unavailable') NOT NULL DEFAULT 'available' AFTER invite_link_hash;

UPDATE channels
SET channel_type = 'public',
    view_tracking_status = 'available'
WHERE channel_type IS NULL
   OR channel_type = '';

CREATE INDEX IF NOT EXISTS idx_channels_type_status
  ON channels (channel_type, status, is_deleted);

CREATE INDEX IF NOT EXISTS idx_channels_invite_hash
  ON channels (invite_link_hash);
