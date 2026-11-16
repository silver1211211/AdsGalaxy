-- Isolated preparation only. Existing campaigns remain NULL/legacy.
ALTER TABLE campaigns
  ADD COLUMN financial_policy_version VARCHAR(64) NULL;
ALTER TABLE campaigns
  ADD CONSTRAINT chk_standard_cpc_click_policy CHECK (
    financial_policy_version IS NULL OR
    (financial_policy_version='adsgalaxy-standard-cpc-click-v1'
      AND type='clicks' AND COALESCE(campaign_kind,'standard') IN ('standard','channel')
      AND funding_model='direct_debit')
  );
-- The policy may be chosen only when a new campaign row is inserted.
CREATE TRIGGER trg_standard_cpc_click_policy_immutable
  BEFORE UPDATE ON campaigns FOR EACH ROW
  SET NEW.financial_policy_version=OLD.financial_policy_version;
