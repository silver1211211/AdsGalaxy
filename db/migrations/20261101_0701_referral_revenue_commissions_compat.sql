-- Additive 10% revenue commissions. The existing referral_commission_ledger is
-- the historical capped unlock ledger and must remain intact.
CREATE TABLE IF NOT EXISTS referral_revenue_commissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  referrer_user_id INT NOT NULL,
  referred_user_id INT NOT NULL,
  referral_id INT NULL,
  product_type VARCHAR(32) NOT NULL,
  source_event_key VARCHAR(191) NOT NULL,
  monetized_earning_amount DECIMAL(18,8) NOT NULL,
  commission_amount DECIMAL(18,8) NOT NULL,
  commission_rate DECIMAL(5,4) NOT NULL DEFAULT 0.1000,
  status VARCHAR(32) NOT NULL DEFAULT 'settled',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_ref_revenue_source_key (source_event_key),
  KEY idx_ref_revenue_referrer (referrer_user_id, created_at),
  KEY idx_ref_revenue_referred (referred_user_id, created_at),
  KEY idx_ref_revenue_product (product_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
