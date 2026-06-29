-- Encrypted private invite links for admin management and the timer-unlocked channel check.
-- Raw private invite links must never be stored in plaintext.

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS private_invite_link_encrypted TEXT NULL AFTER invite_link_hash;
