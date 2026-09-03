-- Promote AdsGalaxy: additive, inactive-by-default campaign accounting.
CREATE TABLE IF NOT EXISTS publisher_promotion_campaigns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(100) NOT NULL,
  name VARCHAR(160) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  duration_days INT UNSIGNED NOT NULL DEFAULT 3,
  starts_at DATETIME(6) NULL,
  ends_at DATETIME(6) NULL,
  activated_at DATETIME(6) NULL,
  paused_at DATETIME(6) NULL,
  closed_at DATETIME(6) NULL,
  payout_review_at DATETIME(6) NULL,
  paid_at DATETIME(6) NULL,
  eligibility_rules JSON NOT NULL,
  created_by_admin_id INT NULL,
  activated_by_admin_id INT NULL,
  payout_approved_by_admin_id INT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_publisher_promotion_slug (slug),
  KEY idx_publisher_promotion_status_dates (status, starts_at, ends_at),
  CONSTRAINT chk_publisher_promotion_duration CHECK (duration_days = 3),
  CONSTRAINT chk_publisher_promotion_dates CHECK (starts_at IS NULL OR ends_at > starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS publisher_promotion_tiers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  minimum_audience BIGINT UNSIGNED NOT NULL,
  maximum_audience BIGINT UNSIGNED NOT NULL,
  reward_amount DECIMAL(18,8) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_publisher_promotion_tier_range (campaign_id, minimum_audience, maximum_audience),
  CONSTRAINT fk_publisher_promotion_tier_campaign FOREIGN KEY (campaign_id) REFERENCES publisher_promotion_campaigns(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_publisher_promotion_tier_range CHECK (minimum_audience <= maximum_audience),
  CONSTRAINT chk_publisher_promotion_tier_amount CHECK (reward_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS publisher_promotion_referrals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  referral_id INT NOT NULL,
  promoter_user_id INT NOT NULL,
  referred_user_id INT NOT NULL,
  referral_created_at DATETIME(6) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'tracked',
  rejection_code VARCHAR(80) NULL,
  eligibility_snapshot JSON NULL,
  tracked_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_publisher_promotion_referral (campaign_id, referral_id),
  UNIQUE KEY uq_publisher_promotion_referred_user (campaign_id, referred_user_id),
  KEY idx_publisher_promotion_promoter (campaign_id, promoter_user_id, status),
  CONSTRAINT fk_publisher_promotion_ref_campaign FOREIGN KEY (campaign_id) REFERENCES publisher_promotion_campaigns(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_publisher_promotion_ref_referral FOREIGN KEY (referral_id) REFERENCES referrals(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_publisher_promotion_ref_promoter FOREIGN KEY (promoter_user_id) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_publisher_promotion_ref_user FOREIGN KEY (referred_user_id) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS publisher_promotion_channel_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  campaign_referral_id BIGINT UNSIGNED NOT NULL,
  channel_id INT NOT NULL,
  normalized_channel_identity VARCHAR(191) NOT NULL,
  event_type VARCHAR(40) NOT NULL DEFAULT 'submitted',
  occurred_at DATETIME(6) NOT NULL,
  channel_created_at DATETIME(6) NOT NULL,
  verified_audience BIGINT UNSIGNED NULL,
  audience_source VARCHAR(40) NULL,
  audience_verified_at DATETIME(6) NULL,
  validation_snapshot JSON NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_publisher_promotion_channel_identity (campaign_id, normalized_channel_identity),
  UNIQUE KEY uq_publisher_promotion_channel_key (idempotency_key),
  KEY idx_publisher_promotion_channel_referral (campaign_referral_id, event_type, occurred_at),
  CONSTRAINT fk_publisher_promotion_channel_campaign FOREIGN KEY (campaign_id) REFERENCES publisher_promotion_campaigns(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_publisher_promotion_channel_ref FOREIGN KEY (campaign_referral_id) REFERENCES publisher_promotion_referrals(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_publisher_promotion_channel_source FOREIGN KEY (channel_id) REFERENCES channels(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS publisher_promotion_rewards (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  campaign_referral_id BIGINT UNSIGNED NOT NULL,
  promoter_user_id INT NOT NULL,
  referred_user_id INT NOT NULL,
  channel_id INT NULL,
  tier_id BIGINT UNSIGNED NULL,
  initial_verified_audience BIGINT UNSIGNED NULL,
  final_verified_audience BIGINT UNSIGNED NULL,
  amount DECIMAL(18,8) NOT NULL DEFAULT 0.00000000,
  status VARCHAR(30) NOT NULL DEFAULT 'pending_channel',
  rejection_code VARCHAR(80) NULL,
  qualified_at DATETIME(6) NULL,
  payable_at DATETIME(6) NULL,
  paid_at DATETIME(6) NULL,
  financial_ledger_id BIGINT UNSIGNED NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  eligibility_snapshot JSON NULL,
  reversal_reference VARCHAR(191) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_publisher_promotion_reward_channel (campaign_id, channel_id),
  UNIQUE KEY uq_publisher_promotion_reward_key (idempotency_key),
  KEY idx_publisher_promotion_reward_status (campaign_id, status, promoter_user_id),
  CONSTRAINT fk_publisher_promotion_reward_campaign FOREIGN KEY (campaign_id) REFERENCES publisher_promotion_campaigns(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_publisher_promotion_reward_ref FOREIGN KEY (campaign_referral_id) REFERENCES publisher_promotion_referrals(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_publisher_promotion_reward_promoter FOREIGN KEY (promoter_user_id) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_publisher_promotion_reward_user FOREIGN KEY (referred_user_id) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_publisher_promotion_reward_channel FOREIGN KEY (channel_id) REFERENCES channels(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_publisher_promotion_reward_tier FOREIGN KEY (tier_id) REFERENCES publisher_promotion_tiers(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_publisher_promotion_reward_amount CHECK (amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS publisher_promotion_payout_batches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  reward_count INT UNSIGNED NOT NULL DEFAULT 0,
  total_amount DECIMAL(24,8) NOT NULL DEFAULT 0.00000000,
  idempotency_key VARCHAR(191) NOT NULL,
  created_by_admin_id INT NULL,
  approved_by_admin_id INT NULL,
  executed_by_admin_id INT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  approved_at DATETIME(6) NULL,
  executed_at DATETIME(6) NULL,
  reconciled_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_publisher_promotion_batch_key (idempotency_key),
  KEY idx_publisher_promotion_batch_campaign (campaign_id, status),
  CONSTRAINT fk_publisher_promotion_batch_campaign FOREIGN KEY (campaign_id) REFERENCES publisher_promotion_campaigns(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS publisher_promotion_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NULL,
  actor_type VARCHAR(30) NOT NULL DEFAULT 'system',
  actor_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  reason VARCHAR(255) NULL,
  metadata JSON NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_publisher_promotion_audit_campaign (campaign_id, created_at),
  KEY idx_publisher_promotion_audit_entity (entity_type, entity_id, created_at),
  CONSTRAINT fk_publisher_promotion_audit_campaign FOREIGN KEY (campaign_id) REFERENCES publisher_promotion_campaigns(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO publisher_promotion_campaigns (slug, name, status, duration_days, eligibility_rules)
VALUES ('promote-ads-galaxy', 'Promote AdsGalaxy', 'draft', 3,
  JSON_OBJECT('referral_window','half_open','channel_submission_during_campaign',TRUE,'approval_after_close',TRUE,'one_reward_per_referred_user',TRUE,'maximum_automatic_audience',20000000))
ON DUPLICATE KEY UPDATE slug = VALUES(slug);

INSERT INTO publisher_promotion_tiers (campaign_id, minimum_audience, maximum_audience, reward_amount)
SELECT id, 2000, 9999, 0.50000000 FROM publisher_promotion_campaigns WHERE slug='promote-ads-galaxy'
UNION ALL SELECT id, 10000, 49999, 1.00000000 FROM publisher_promotion_campaigns WHERE slug='promote-ads-galaxy'
UNION ALL SELECT id, 50000, 199999, 2.50000000 FROM publisher_promotion_campaigns WHERE slug='promote-ads-galaxy'
UNION ALL SELECT id, 200000, 999999, 6.00000000 FROM publisher_promotion_campaigns WHERE slug='promote-ads-galaxy'
UNION ALL SELECT id, 1000000, 9999999, 15.00000000 FROM publisher_promotion_campaigns WHERE slug='promote-ads-galaxy'
UNION ALL SELECT id, 10000000, 20000000, 50.00000000 FROM publisher_promotion_campaigns WHERE slug='promote-ads-galaxy'
ON DUPLICATE KEY UPDATE reward_amount=VALUES(reward_amount);
