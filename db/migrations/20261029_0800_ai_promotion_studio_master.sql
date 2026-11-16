-- ==============================================================================
-- AdsGalaxy AI Promotion Studio — Master Intelligence & Runware Schema Upgrade
-- Safe, additive migration: adds campaign_name, profile_version, master_memory_id,
-- and ensures cost telemetry and creative memory indexes are fully established.
-- ==============================================================================

-- 1. Add Master Identity & Campaign Name to ai_creative_memory
ALTER TABLE ai_creative_memory
  ADD COLUMN IF NOT EXISTS campaign_name VARCHAR(100) NULL AFTER creative_hash,
  ADD COLUMN IF NOT EXISTS profile_version VARCHAR(32) DEFAULT '1.0.0' AFTER review_status,
  ADD COLUMN IF NOT EXISTS master_memory_id VARCHAR(64) DEFAULT 'ADSGALAXY_AI_STUDIO_MASTER' AFTER profile_version;

-- 2. Ensure indexes for category performance and strategic memory retrieval
CREATE INDEX IF NOT EXISTS idx_ai_creative_memory_master_perf
  ON ai_creative_memory (master_memory_id, performance_rating, ctr);

CREATE INDEX IF NOT EXISTS idx_ai_creative_memory_cat_perf
  ON ai_creative_memory (performance_rating, total_impressions, ctr);

-- 3. Ensure official studio settings exist with safe disabled defaults
INSERT IGNORE INTO settings (`key`, value, description) VALUES
  ('ai_studio_enabled', '0', 'AI Promotion Studio global master switch (0=disabled, 1=enabled)'),
  ('ai_studio_master_pause', '1', 'AI Promotion Studio emergency pause (0=normal, 1=paused)'),
  ('ai_studio_provider', 'runware', 'AI Generation provider (runware)'),
  ('ai_studio_text_model', 'zai:glm@5.3-flash', 'AI Text Generation Model for copy and prompt strategy'),
  ('ai_studio_image_model', 'runware:z-image@turbo', 'AI Image Generation Model for 1024x1024 artwork'),
  ('ai_studio_cpc_rate', '50.00', 'Internal fixed CPC rate: 50 USDT per 1,000 valid clicks'),
  ('ai_studio_daily_gen_limit', '20', 'Default daily AI campaign creation limit'),
  ('ai_studio_daily_cost_limit', '5.00', 'Daily AI generation cost ceiling in USD'),
  ('ai_studio_monthly_cost_limit', '50.00', 'Monthly AI generation cost ceiling in USD'),
  ('ai_studio_min_eval_impressions', '1000', 'Minimum impressions required before CTR evaluation'),
  ('ai_studio_min_ctr_threshold', '1.20', 'Underperformance CTR threshold (%) for 48h retirement'),
  ('ai_studio_winner_ctr_threshold', '2.00', 'Winning creative CTR threshold (%) for reuse eligibility'),
  ('ai_studio_destination_url', 'https://t.me/Ads_Galaxy_bot?start=REF770190998629F', 'Official AdsGalaxy studio campaign destination link');
