-- Never discard a recorded funding allocation.
DROP PROCEDURE IF EXISTS rollback_smart_reach_allocations_20261113;
DELIMITER $$
CREATE PROCEDURE rollback_smart_reach_allocations_20261113()
BEGIN
  IF (SELECT COUNT(*) FROM channel_smart_reach_funding_allocations)<>0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='smart_reach_funding_allocations_exist';
  END IF;
END$$
DELIMITER ;
CALL rollback_smart_reach_allocations_20261113();
DROP PROCEDURE rollback_smart_reach_allocations_20261113;
DROP TABLE channel_smart_reach_funding_allocations;
ALTER TABLE channel_smart_reach_impression_billings DROP KEY uq_smart_billing_funding_identity;
ALTER TABLE channel_smart_reach_view_claims DROP KEY uq_smart_claim_funding_identity;
