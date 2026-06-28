-- Add recommended CPM settings for views and clicks campaigns
-- Admin can edit these via the Settings page

INSERT IGNORE INTO settings (`key`, value, description)
VALUES
  ('recommended_cpm_views',    '1.50', 'Recommended CPM bid for Views campaigns (shown as default on campaign wizard slider)'),
  ('recommended_cpm_clicks',   '5.00', 'Recommended CPM bid for Clicks campaigns (shown as default on campaign wizard slider)'),
  ('recommended_cpm_broadcast','3.00', 'Recommended CPM bid for Bot Broadcast campaigns (shown as default on campaign wizard slider)');
