-- Owner-run rollback only. Refuses to remove financial evidence once entries exist.
DROP PROCEDURE IF EXISTS rollback_standard_cpc_allowance_ledger_20261113;
DELIMITER $$
CREATE PROCEDURE rollback_standard_cpc_allowance_ledger_20261113()
BEGIN
  IF (SELECT COUNT(*) FROM channel_standard_cpc_allowance_ledger) <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='allowance_ledger_not_empty';
  END IF;
  DROP TABLE channel_standard_cpc_allowance_ledger;
END$$
DELIMITER ;
CALL rollback_standard_cpc_allowance_ledger_20261113();
DROP PROCEDURE rollback_standard_cpc_allowance_ledger_20261113;
