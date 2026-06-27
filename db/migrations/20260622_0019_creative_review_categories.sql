-- Phase 9A: advertiser creative review, category targeting, and category CPM controls.
-- Additive only. CPM engine formulas, payouts, settlements, withdrawals, and network integrations remain unchanged.

ALTER TABLE miniapp_rewarded_campaigns
  ADD COLUMN IF NOT EXISTS categories JSON NULL AFTER body_color,
  ADD COLUMN IF NOT EXISTS required_cpm DECIMAL(18,8) NOT NULL DEFAULT 0 AFTER admin_cpm,
  ADD COLUMN IF NOT EXISTS creative_review_status VARCHAR(30) NOT NULL DEFAULT 'pending' AFTER status,
  ADD COLUMN IF NOT EXISTS creative_review_notes TEXT NULL AFTER creative_review_status,
  ADD COLUMN IF NOT EXISTS landing_review_flags JSON NULL AFTER creative_review_notes,
  ADD COLUMN IF NOT EXISTS image_review_metadata JSON NULL AFTER landing_review_flags;

INSERT INTO settings (`key`, value) VALUES
  ('miniapp_category_cpm_adjustment_general', '0.00'),
  ('miniapp_category_cpm_adjustment_utilities', '0.00'),
  ('miniapp_category_cpm_adjustment_education', '0.25'),
  ('miniapp_category_cpm_adjustment_ai', '0.50'),
  ('miniapp_category_cpm_adjustment_gaming', '0.00'),
  ('miniapp_category_cpm_adjustment_finance', '0.75'),
  ('miniapp_category_cpm_adjustment_crypto', '1.00'),
  ('miniapp_category_cpm_adjustment_trading', '1.25'),
  ('miniapp_category_cpm_adjustment_shopping', '0.00'),
  ('miniapp_category_cpm_adjustment_entertainment', '0.00'),
  ('miniapp_category_cpm_adjustment_other', '0.00')
ON DUPLICATE KEY UPDATE value = value;
