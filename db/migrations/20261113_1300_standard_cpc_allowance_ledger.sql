-- Phase 1B Task 1: structure only. No historical backfill or production execution.
-- AdsGalaxy operating-fund advances are distinct from channel_reserve_treasury_ledger.
CREATE TABLE channel_standard_cpc_allowance_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id INT NOT NULL,
  publisher_id INT NOT NULL,
  operation ENUM('advance','recovery','reversal') NOT NULL,
  amount DECIMAL(24,8) NOT NULL,
  outstanding_delta DECIMAL(24,8) NOT NULL,
  source_system ENUM('standard_cpc_advance','standard_cpc_arr','standard_cpc_reversal') NOT NULL,
  source_transaction_key VARCHAR(191) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  applies_to_advance_entry_id BIGINT UNSIGNED NULL,
  reverses_entry_id BIGINT UNSIGNED NULL,
  policy_version VARCHAR(64) NOT NULL DEFAULT 'adsgalaxy-standard-cpc-allowance-v1',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_standard_cpc_allowance_id_campaign (id,campaign_id),
  UNIQUE KEY uq_standard_cpc_allowance_id_campaign_publisher (id,campaign_id,publisher_id),
  UNIQUE KEY uq_standard_cpc_allowance_idempotency (idempotency_key),
  UNIQUE KEY uq_standard_cpc_allowance_source (source_system,source_transaction_key),
  KEY ix_standard_cpc_allowance_reversal (reverses_entry_id),
  KEY ix_standard_cpc_allowance_advance (applies_to_advance_entry_id,campaign_id),
  KEY ix_standard_cpc_allowance_campaign_order (campaign_id,id),
  KEY ix_standard_cpc_allowance_campaign_publisher (campaign_id,publisher_id,id),
  CONSTRAINT fk_standard_cpc_allowance_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT,
  CONSTRAINT fk_standard_cpc_allowance_publisher FOREIGN KEY (publisher_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_standard_cpc_allowance_reversal FOREIGN KEY (reverses_entry_id,campaign_id,publisher_id)
    REFERENCES channel_standard_cpc_allowance_ledger(id,campaign_id,publisher_id) ON DELETE RESTRICT,
  CONSTRAINT fk_standard_cpc_allowance_advance FOREIGN KEY (applies_to_advance_entry_id,campaign_id,publisher_id)
    REFERENCES channel_standard_cpc_allowance_ledger(id,campaign_id,publisher_id) ON DELETE RESTRICT,
  CONSTRAINT chk_standard_cpc_allowance_positive CHECK (amount > 0 AND amount <= 5.00000000),
  CONSTRAINT chk_standard_cpc_allowance_operation CHECK (
    (operation='advance' AND source_system='standard_cpc_advance' AND outstanding_delta=amount
      AND applies_to_advance_entry_id IS NULL AND reverses_entry_id IS NULL)
    OR (operation='recovery' AND source_system='standard_cpc_arr' AND outstanding_delta=-amount
      AND applies_to_advance_entry_id IS NOT NULL AND reverses_entry_id IS NULL)
    OR (operation='reversal' AND source_system='standard_cpc_reversal'
      AND outstanding_delta IN (amount,-amount) AND applies_to_advance_entry_id IS NULL AND reverses_entry_id IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
