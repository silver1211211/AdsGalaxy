-- Historical entitlements and credits must remain auditable.
DROP PROCEDURE IF EXISTS rollback_standard_cpc_view_entitlements_20261113;
DELIMITER $$
CREATE PROCEDURE rollback_standard_cpc_view_entitlements_20261113()
BEGIN
  IF (SELECT COUNT(*) FROM channel_standard_cpc_view_entitlements) <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='standard_cpc_view_entitlements_exist';
  END IF;
  DROP TABLE channel_standard_cpc_view_entitlements;
END$$
DELIMITER ;
CALL rollback_standard_cpc_view_entitlements_20261113();
DROP PROCEDURE rollback_standard_cpc_view_entitlements_20261113;
