-- Refuse rollback after any campaign has selected the new policy.
DROP PROCEDURE IF EXISTS rollback_standard_cpc_click_policy_20261113;
DELIMITER $$
CREATE PROCEDURE rollback_standard_cpc_click_policy_20261113()
BEGIN
  IF (SELECT COUNT(*) FROM campaigns WHERE financial_policy_version IS NOT NULL) <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='new_cpc_policy_campaigns_exist';
  END IF;
  DROP TRIGGER trg_standard_cpc_click_policy_immutable;
  ALTER TABLE campaigns DROP CONSTRAINT chk_standard_cpc_click_policy;
  ALTER TABLE campaigns DROP COLUMN financial_policy_version;
END$$
DELIMITER ;
CALL rollback_standard_cpc_click_policy_20261113();
DROP PROCEDURE rollback_standard_cpc_click_policy_20261113;
