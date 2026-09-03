ALTER TABLE publisher_promotion_campaigns
  ADD COLUMN scheduled_at DATETIME(6) NULL AFTER duration_days,
  ADD COLUMN wallet_edit_ends_at DATETIME(6) NULL AFTER ends_at;

CREATE TABLE publisher_promotion_referral_links (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  promoter_user_id INT NOT NULL,
  token VARCHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_promotion_link_campaign_user (campaign_id,promoter_user_id),
  UNIQUE KEY uq_promotion_link_token (token),
  CONSTRAINT fk_promotion_link_campaign FOREIGN KEY (campaign_id) REFERENCES publisher_promotion_campaigns(id),
  CONSTRAINT fk_promotion_link_user FOREIGN KEY (promoter_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE publisher_promotion_link_attributions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  link_id BIGINT UNSIGNED NOT NULL,
  referral_id INT NOT NULL,
  promoter_user_id INT NOT NULL,
  referred_user_id INT NOT NULL,
  attributed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_promotion_attribution_referral (referral_id),
  KEY idx_promotion_attribution_campaign (campaign_id,promoter_user_id,attributed_at),
  CONSTRAINT fk_promotion_attribution_campaign FOREIGN KEY (campaign_id) REFERENCES publisher_promotion_campaigns(id),
  CONSTRAINT fk_promotion_attribution_link FOREIGN KEY (link_id) REFERENCES publisher_promotion_referral_links(id),
  CONSTRAINT fk_promotion_attribution_referral FOREIGN KEY (referral_id) REFERENCES referrals(id),
  CONSTRAINT fk_promotion_attribution_promoter FOREIGN KEY (promoter_user_id) REFERENCES users(id),
  CONSTRAINT fk_promotion_attribution_user FOREIGN KEY (referred_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE publisher_promotion_wallets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NOT NULL,
  user_id INT NOT NULL,
  network VARCHAR(20) NOT NULL,
  address VARCHAR(191) NOT NULL,
  saved_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_promotion_wallet_campaign_user (campaign_id,user_id),
  CONSTRAINT fk_promotion_wallet_campaign FOREIGN KEY (campaign_id) REFERENCES publisher_promotion_campaigns(id),
  CONSTRAINT fk_promotion_wallet_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
