-- Never discard a campaign's selected financial mode or configured rate.
DROP PROCEDURE IF EXISTS rollback_smart_reach_configuration_20261113;
DELIMITER $$
CREATE PROCEDURE rollback_smart_reach_configuration_20261113()
BEGIN
  IF (SELECT COUNT(*) FROM campaigns WHERE financial_billing_mode IS NOT NULL
       OR smart_reach_max_cpm IS NOT NULL OR smart_reach_effective_cpm IS NOT NULL
       OR smart_reach_last_evaluated_at IS NOT NULL) <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='smart_reach_configuration_in_use';
  END IF;
END$$
DELIMITER ;
CALL rollback_smart_reach_configuration_20261113();
DROP PROCEDURE rollback_smart_reach_configuration_20261113;
DROP TRIGGER trg_channel_financial_policy_immutable;
ALTER TABLE campaigns DROP CONSTRAINT chk_channel_financial_configuration;
ALTER TABLE campaigns DROP COLUMN financial_billing_mode,
  DROP COLUMN smart_reach_max_cpm,
  DROP COLUMN smart_reach_effective_cpm,
  DROP COLUMN smart_reach_last_evaluated_at;
ALTER TABLE campaigns ADD CONSTRAINT chk_standard_cpc_click_policy CHECK (
  financial_policy_version IS NULL OR
  (financial_policy_version='adsgalaxy-standard-cpc-click-v1'
    AND type='clicks' AND COALESCE(campaign_kind,'standard') IN ('standard','channel')
    AND funding_model='direct_debit')
);
CREATE TRIGGER trg_standard_cpc_click_policy_immutable
  BEFORE UPDATE ON campaigns FOR EACH ROW
  SET NEW.financial_policy_version=OLD.financial_policy_version;
