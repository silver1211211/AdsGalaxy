-- AdsGalaxy public homepage footer settings.
-- Adds the editable footer fields surfaced in Admin -> System Settings.
-- These are read by the public homepage footer with safe defaults if missing.
-- Safe to re-run: INSERT IGNORE skips rows that already exist.

INSERT IGNORE INTO settings (`key`, value) VALUES
  ('footer_year', '2026'),
  ('footer_brand', 'AdsGalaxy.online'),
  ('footer_rights_text', 'All rights reserved.');
