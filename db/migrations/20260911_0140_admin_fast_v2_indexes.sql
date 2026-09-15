-- Admin FAST V2: move schema preparation out of request handlers and support bounded list filters.
-- Additive and idempotent; no data backfill or financial/campaign mutation.
ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS network VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS address VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS fee DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount DECIMAL(18,8) NOT NULL DEFAULT 0,
  ADD KEY IF NOT EXISTS idx_withdrawals_status_id (status,id);

ALTER TABLE users
  ADD KEY IF NOT EXISTS idx_users_status_id (status,id),
  ADD KEY IF NOT EXISTS idx_users_advertiser_trust_id (advertiser_trust_level,id);

ALTER TABLE channels
  ADD KEY IF NOT EXISTS idx_channels_status_deleted_id (status,is_deleted,id);

ALTER TABLE campaigns
  ADD KEY IF NOT EXISTS idx_campaigns_status_id (status,id);

ALTER TABLE miniapp_rewarded_campaigns
  ADD KEY IF NOT EXISTS idx_miniapp_campaigns_status_id (status,id);

ALTER TABLE deposits
  ADD KEY IF NOT EXISTS idx_deposits_status_id (status,id);

ALTER TABLE system_logs
  ADD KEY IF NOT EXISTS idx_system_logs_created_id (created_at,id);

ALTER TABLE campaign_views_audit
  ADD KEY IF NOT EXISTS idx_campaign_views_post_check_id (post_id,check_time,id);

ALTER TABLE referral_reward_ledger
  ADD KEY IF NOT EXISTS idx_referral_reward_user_status (user_id,status);
