-- Task 5A: configuration only. Existing rows retain NULL/legacy configuration.
ALTER TABLE campaigns
  ADD COLUMN financial_billing_mode VARCHAR(32) NULL,
  ADD COLUMN smart_reach_max_cpm DECIMAL(24,8) NULL,
  ADD COLUMN smart_reach_effective_cpm DECIMAL(24,8) NULL,
  ADD COLUMN smart_reach_last_evaluated_at DATETIME(6) NULL;

ALTER TABLE campaigns DROP CONSTRAINT chk_standard_cpc_click_policy;
ALTER TABLE campaigns ADD CONSTRAINT chk_channel_financial_configuration CHECK (
  (financial_policy_version IS NULL AND financial_billing_mode IS NULL
    AND smart_reach_max_cpm IS NULL AND smart_reach_effective_cpm IS NULL
    AND smart_reach_last_evaluated_at IS NULL)
  OR
  (financial_policy_version='adsgalaxy-standard-cpc-click-v1'
    AND (financial_billing_mode IS NULL OR financial_billing_mode='standard_cpc')
    AND type='clicks' AND COALESCE(campaign_kind,'standard') IN ('standard','channel')
    AND funding_model='direct_debit' AND smart_reach_max_cpm IS NULL
    AND smart_reach_effective_cpm IS NULL AND smart_reach_last_evaluated_at IS NULL)
  OR
  (financial_policy_version='adsgalaxy-smart-reach-v1'
    AND financial_billing_mode='smart_reach' AND type='clicks'
    AND COALESCE(campaign_kind,'standard') IN ('standard','channel')
    AND funding_model='direct_debit'
    AND smart_reach_max_cpm BETWEEN 0.10000000 AND 0.50000000
    AND smart_reach_effective_cpm BETWEEN 0.10000000 AND smart_reach_max_cpm)
);

DROP TRIGGER trg_standard_cpc_click_policy_immutable;
CREATE TRIGGER trg_channel_financial_policy_immutable
  BEFORE UPDATE ON campaigns FOR EACH ROW
  SET NEW.financial_policy_version=OLD.financial_policy_version,
      NEW.financial_billing_mode=OLD.financial_billing_mode;
