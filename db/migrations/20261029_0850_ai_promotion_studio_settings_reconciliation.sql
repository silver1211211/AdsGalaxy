-- =============================================================================
-- AdsGalaxy AI Promotion Studio — Authoritative Default Settings Reconciliation
-- Migration: 20261029_0850_ai_promotion_studio_settings_reconciliation.sql
--
-- Purpose:
--   Reconciles AI Promotion Studio settings in the `settings` table where
--   20261029_0159 inserted initial defaults (`ai_studio_master_pause = '0'`,
--   `ai_studio_daily_gen_limit = '50'`, Gemini models, empty destination URL)
--   and 20261029_0800 used `INSERT IGNORE`, leaving `ai_studio_master_pause`
--   and `ai_studio_daily_gen_limit` un-updated.
--   Ensures the Studio remains disabled (`ai_studio_enabled = '0'`) and paused
--   (`ai_studio_master_pause = '1'`) after migration with the exact approved
--   Runware model identifiers, daily generation limit (20), official CPC
--   exception rate (50.00000000 USDT), and referral destination URL.
-- =============================================================================

INSERT INTO settings (`key`, `value`, description) VALUES
  ('ai_studio_enabled', '0', 'Master toggle for AdsGalaxy AI Promotion Studio automation (0=disabled, 1=enabled)'),
  ('ai_studio_master_pause', '1', 'Emergency pause toggle for AI Promotion Studio'),
  ('ai_studio_daily_gen_limit', '20', 'Maximum number of AI campaigns generated per UTC day'),
  ('ai_studio_provider', 'runware', 'Unified AI generation provider (runware)'),
  ('ai_studio_text_model', 'zai:glm@5.3-flash', 'Runware text generation model identifier (GLM-5.3 Flash)'),
  ('ai_studio_image_model', 'runware:z-image@turbo', 'Runware image generation model identifier (Z-Image Turbo)'),
  ('ai_studio_destination_url', 'https://t.me/Ads_Galaxy_bot?start=REF770190998629F', 'Official referral destination link for AI Promotion Studio campaigns'),
  ('ai_studio_cpc_rate', '50.00000000', 'Fixed internal CPC rate per 1,000 valid clicks in USDT (0.05 USDT per click)')
ON DUPLICATE KEY UPDATE
  `value` = VALUES(`value`),
  description = VALUES(description);
