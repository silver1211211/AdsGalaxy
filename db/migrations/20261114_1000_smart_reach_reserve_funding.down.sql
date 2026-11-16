-- Refuse to discard any reserve commitments or payment attribution.
DROP PROCEDURE IF EXISTS rollback_smart_reach_reserve_funding_20261114;
DELIMITER $$
CREATE PROCEDURE rollback_smart_reach_reserve_funding_20261114()
BEGIN
  IF (SELECT COUNT(*) FROM channel_smart_reach_reserve_fundings)<>0
    OR (SELECT COUNT(*) FROM channel_smart_reach_reserve_allocations)<>0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='smart_reach_reserve_funding_records_exist';
  END IF;
END$$
DELIMITER ;
CALL rollback_smart_reach_reserve_funding_20261114();
DROP PROCEDURE rollback_smart_reach_reserve_funding_20261114;
DROP TABLE channel_smart_reach_reserve_allocations;
DROP TABLE channel_smart_reach_reserve_fundings;
ALTER TABLE channel_reserve_treasury_ledger DROP KEY uq_smart_reserve_source_campaign;
