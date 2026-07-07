-- Separate CPM controls by product surface.
-- Idempotent and non-destructive: existing production values are preserved.

INSERT INTO settings (`key`, value, description) VALUES
  ('min_cpm_views', '0.50', 'Minimum CPM for channel view campaigns.'),
  ('recommended_cpm_views', '1.50', 'Recommended CPM for channel view campaigns.'),
  ('max_cpm_views', '5.00', 'Maximum CPM for channel view campaigns.'),
  ('min_cpm_clicks', '2.00', 'Minimum CPM for channel click campaigns.'),
  ('recommended_cpm_clicks', '5.00', 'Recommended CPM for channel click campaigns.'),
  ('max_cpm_clicks', '20.00', 'Maximum CPM for channel click campaigns.'),
  ('min_cpm_broadcast', '1.00', 'Minimum CPM for bot broadcast campaigns.'),
  ('recommended_cpm_broadcast', '3.00', 'Recommended CPM for bot broadcast campaigns.'),
  ('max_cpm_broadcast', '10.00', 'Maximum CPM for bot broadcast campaigns.'),
  ('miniapp_internal_min_cpm', '0.50', 'Minimum CPM for Mini App rewarded campaigns.'),
  ('miniapp_internal_recommended_cpm', '1.00', 'Recommended CPM for Mini App rewarded campaigns.'),
  ('miniapp_internal_max_cpm', '5.00', 'Maximum CPM for Mini App rewarded campaigns.')
ON DUPLICATE KEY UPDATE description = VALUES(description);

UPDATE settings
SET value = COALESCE((SELECT v FROM (SELECT value AS v FROM settings WHERE `key` = 'global_min_cpm' LIMIT 1) legacy), value)
WHERE `key` = 'miniapp_internal_min_cpm'
  AND value = '0.50';

UPDATE settings
SET value = COALESCE((SELECT v FROM (SELECT value AS v FROM settings WHERE `key` = 'global_recommended_cpm' LIMIT 1) legacy), value)
WHERE `key` = 'miniapp_internal_recommended_cpm'
  AND value = '1.00';

UPDATE settings
SET value = COALESCE((SELECT v FROM (SELECT value AS v FROM settings WHERE `key` = 'global_max_cpm' LIMIT 1) legacy), value)
WHERE `key` = 'miniapp_internal_max_cpm'
  AND value = '5.00';
