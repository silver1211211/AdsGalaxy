-- Auditable Views waivers and race-safe channel daily-cap lifecycle.
-- Additive only. Raw views and existing financial history remain unchanged.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS daily_cap_reached_at DATETIME NULL AFTER daily_budget_limit,
  ADD COLUMN IF NOT EXISTS daily_cap_billing_date DATE NULL AFTER daily_cap_reached_at;

CREATE INDEX IF NOT EXISTS idx_campaigns_daily_cap_resume
  ON campaigns(status,daily_cap_billing_date,auto_reactivate);

CREATE TABLE IF NOT EXISTS channel_view_waivers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id INT NOT NULL,
  post_id INT NOT NULL,
  waived_views INT UNSIGNED NOT NULL,
  reason VARCHAR(160) NOT NULL,
  financial_effect DECIMAL(18,8) NOT NULL DEFAULT 0,
  metadata JSON NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(id),
  UNIQUE KEY uq_channel_view_waiver(post_id,reason),
  KEY idx_channel_view_waiver_campaign(campaign_id),
  CONSTRAINT fk_channel_view_waiver_campaign FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_channel_view_waiver_post FOREIGN KEY(post_id) REFERENCES campaign_posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_channel_view_waiver_admin FOREIGN KEY(created_by) REFERENCES admins(id) ON DELETE SET NULL,
  CONSTRAINT chk_channel_view_waiver_financial_zero CHECK(financial_effect=0),
  CONSTRAINT chk_channel_view_waiver_positive CHECK(waived_views>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Campaign #60's earlier fixed 11,353-unit estimate was superseded before this
-- migration was applied. The immutable old-placement cutoff and exact final
-- live waiver are recorded by migration 0150. Keep this migration limited to
-- the reusable waiver and daily-cap infrastructure.
