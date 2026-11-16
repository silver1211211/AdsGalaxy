-- Task 5B-1A: schema only. No historical backfill, balance mutation or billing.
-- The account row is the stable lock and database-enforced per-campaign publisher cap.
CREATE TABLE channel_smart_reach_publisher_accounts (
  campaign_id INT NOT NULL,
  publisher_id INT NOT NULL,
  entitled_amount DECIMAL(24,8) NOT NULL DEFAULT 0,
  funded_amount DECIMAL(24,8) NOT NULL DEFAULT 0,
  pending_amount DECIMAL(24,8) NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (campaign_id,publisher_id),
  CONSTRAINT fk_smart_account_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT,
  CONSTRAINT fk_smart_account_publisher FOREIGN KEY (publisher_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_smart_account_amounts CHECK (entitled_amount>=0 AND entitled_amount<=0.10000000
    AND funded_amount>=0 AND funded_amount<=entitled_amount
    AND pending_amount=entitled_amount-funded_amount)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One claim per placement. Later settlement locks the account before modifying claims.
CREATE TABLE channel_smart_reach_view_claims (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  campaign_id INT NOT NULL,
  publisher_id INT NOT NULL,
  post_id INT NOT NULL,
  channel_id INT NOT NULL,
  observed_views BIGINT UNSIGNED NOT NULL DEFAULT 0,
  entitled_amount DECIMAL(24,8) NOT NULL DEFAULT 0,
  funded_amount DECIMAL(24,8) NOT NULL DEFAULT 0,
  pending_amount DECIMAL(24,8) NOT NULL DEFAULT 0,
  last_funded_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_smart_claim_post (post_id),
  UNIQUE KEY uq_smart_claim_identity (id,campaign_id,publisher_id,post_id),
  KEY ix_smart_claim_fair_queue (campaign_id,pending_amount,last_funded_at,created_at,id),
  CONSTRAINT fk_smart_claim_account FOREIGN KEY (campaign_id,publisher_id)
    REFERENCES channel_smart_reach_publisher_accounts(campaign_id,publisher_id) ON DELETE RESTRICT,
  CONSTRAINT fk_smart_claim_post FOREIGN KEY (post_id) REFERENCES campaign_posts(id) ON DELETE RESTRICT,
  CONSTRAINT chk_smart_claim_amounts CHECK (entitled_amount>=0 AND entitled_amount<=0.10000000
    AND funded_amount>=0 AND funded_amount<=entitled_amount
    AND pending_amount=entitled_amount-funded_amount)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Each event identifies the durable view audit, cumulative observed range and
-- the existing wallet debit / publisher balance transaction references.
CREATE TABLE channel_smart_reach_impression_billings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  idempotency_key VARCHAR(191) NOT NULL,
  campaign_id INT NOT NULL,
  publisher_id INT NOT NULL,
  post_id INT NOT NULL,
  channel_id INT NOT NULL,
  advertiser_id INT NOT NULL,
  claim_id BIGINT UNSIGNED NOT NULL,
  view_audit_id INT NOT NULL,
  from_view_count BIGINT UNSIGNED NOT NULL,
  through_view_count BIGINT UNSIGNED NOT NULL,
  billable_views BIGINT UNSIGNED NOT NULL,
  effective_cpm DECIMAL(24,8) NOT NULL,
  advertiser_charge DECIMAL(24,8) NOT NULL,
  publisher_pool_amount DECIMAL(24,8) NOT NULL,
  publisher_funding DECIMAL(24,8) NOT NULL DEFAULT 0,
  funding_source ENUM('advertiser_impression') NOT NULL DEFAULT 'advertiser_impression',
  wallet_debit_source_key VARCHAR(191) NOT NULL,
  publisher_credit_source_key VARCHAR(191) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_smart_billing_key (idempotency_key),
  UNIQUE KEY uq_smart_billing_wallet (wallet_debit_source_key),
  UNIQUE KEY uq_smart_billing_credit (publisher_credit_source_key),
  UNIQUE KEY uq_smart_billing_audit (view_audit_id),
  UNIQUE KEY uq_smart_billing_cursor (post_id,through_view_count),
  KEY ix_smart_billing_campaign_publisher (campaign_id,publisher_id,id),
  CONSTRAINT fk_smart_billing_claim FOREIGN KEY (claim_id,campaign_id,publisher_id,post_id)
    REFERENCES channel_smart_reach_view_claims(id,campaign_id,publisher_id,post_id) ON DELETE RESTRICT,
  CONSTRAINT fk_smart_billing_audit FOREIGN KEY (view_audit_id) REFERENCES campaign_views_audit(id) ON DELETE RESTRICT,
  CONSTRAINT fk_smart_billing_advertiser FOREIGN KEY (advertiser_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_smart_billing_views CHECK (through_view_count>from_view_count
    AND billable_views<=through_view_count-from_view_count AND billable_views>0),
  CONSTRAINT chk_smart_billing_money CHECK (effective_cpm BETWEEN 0.10000000 AND 0.50000000
    AND advertiser_charge>0 AND publisher_pool_amount>=0
    AND publisher_pool_amount<=advertiser_charge
    AND publisher_funding>=0 AND publisher_funding<=publisher_pool_amount
    AND (publisher_funding=0 OR publisher_credit_source_key IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
