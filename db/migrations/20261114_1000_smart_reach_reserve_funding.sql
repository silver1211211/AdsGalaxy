-- Schema only. No reserve consumption or publisher balance writes.
-- Composite identities prevent funding from a different campaign's treasury row.
ALTER TABLE channel_reserve_treasury_ledger
  ADD UNIQUE KEY uq_smart_reserve_source_campaign (id,campaign_id,entry_type,direction);

CREATE TABLE channel_smart_reach_reserve_fundings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reserve_ledger_id BIGINT UNSIGNED NOT NULL,
  source_entry_type ENUM('allocation_inflow','authorized_funding','advance_outflow','recovery_inflow','quality_bonus_outflow','reversal','adjustment') NOT NULL DEFAULT 'allocation_inflow',
  source_direction ENUM('in','out') NOT NULL DEFAULT 'in',
  campaign_id INT NOT NULL,
  publisher_id INT NOT NULL,
  claim_id BIGINT UNSIGNED NOT NULL,
  committed_amount DECIMAL(24,8) NOT NULL,
  consumed_amount DECIMAL(24,8) NOT NULL DEFAULT 0,
  status ENUM('committed','consumed','released') NOT NULL DEFAULT 'committed',
  idempotency_key VARCHAR(191) NOT NULL,
  source_financial_ref VARCHAR(191) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  consumed_at DATETIME(6) NULL,
  released_at DATETIME(6) NULL,
  UNIQUE KEY uq_smart_reserve_funding_key (idempotency_key),
  UNIQUE KEY uq_smart_reserve_funding_identity (id,claim_id,campaign_id,publisher_id),
  KEY ix_smart_reserve_funding_source (reserve_ledger_id,status),
  KEY ix_smart_reserve_funding_campaign (campaign_id,status,id),
  CONSTRAINT fk_smart_reserve_source FOREIGN KEY (reserve_ledger_id,campaign_id,source_entry_type,source_direction)
    REFERENCES channel_reserve_treasury_ledger(id,campaign_id,entry_type,direction) ON DELETE RESTRICT,
  CONSTRAINT fk_smart_reserve_claim FOREIGN KEY (claim_id,campaign_id,publisher_id)
    REFERENCES channel_smart_reach_view_claims(id,campaign_id,publisher_id) ON DELETE RESTRICT,
  CONSTRAINT chk_smart_reserve_funding_amount CHECK
    (committed_amount>0 AND consumed_amount>=0 AND consumed_amount<=committed_amount),
  CONSTRAINT chk_smart_reserve_collected_source CHECK
    (source_entry_type='allocation_inflow' AND source_direction='in'),
  CONSTRAINT chk_smart_reserve_funding_state CHECK
    ((status='committed' AND consumed_amount=0 AND consumed_at IS NULL AND released_at IS NULL)
     OR (status='consumed' AND consumed_amount=committed_amount AND consumed_at IS NOT NULL AND released_at IS NULL)
     OR (status='released' AND consumed_amount=0 AND consumed_at IS NULL AND released_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Separate source table preserves the existing advertiser-impression FK and enum.
-- Later funding must sum this table and advertiser allocations under the same
-- stable publisher-account lock before increasing the claim's funded_amount.
CREATE TABLE channel_smart_reach_reserve_allocations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  reserve_funding_id BIGINT UNSIGNED NOT NULL,
  claim_id BIGINT UNSIGNED NOT NULL,
  campaign_id INT NOT NULL,
  publisher_id INT NOT NULL,
  amount DECIMAL(24,8) NOT NULL,
  funding_source ENUM('collected_reserve') NOT NULL DEFAULT 'collected_reserve',
  idempotency_key VARCHAR(191) NOT NULL,
  publisher_credit_source_key VARCHAR(191) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_smart_reserve_allocation_key (idempotency_key),
  UNIQUE KEY uq_smart_reserve_allocation_funding (reserve_funding_id),
  UNIQUE KEY uq_smart_reserve_allocation_credit (publisher_credit_source_key),
  KEY ix_smart_reserve_allocation_claim (claim_id,id),
  CONSTRAINT fk_smart_reserve_allocation_funding FOREIGN KEY
    (reserve_funding_id,claim_id,campaign_id,publisher_id)
    REFERENCES channel_smart_reach_reserve_fundings(id,claim_id,campaign_id,publisher_id) ON DELETE RESTRICT,
  CONSTRAINT chk_smart_reserve_allocation_positive CHECK (amount>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
