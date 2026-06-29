-- Temporary shareable channel-check unlock state.
-- Stores only timestamps/duration/admin id reference. No passwords or secrets.

INSERT IGNORE INTO settings (`key`, value, description) VALUES
  ('channel_check_unlocked_until', '0', 'Temporary channel-check page global unlock expiry as epoch milliseconds'),
  ('channel_check_last_unlocked_at', '0', 'Temporary channel-check page last unlock time as epoch milliseconds'),
  ('channel_check_duration_minutes', '60', 'Temporary channel-check page last configured unlock duration in minutes'),
  ('channel_check_unlocked_by_admin_id', '', 'Admin id that last unlocked the temporary channel-check page');
