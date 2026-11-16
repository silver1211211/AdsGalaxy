-- Refuse destructive rollback once any Smart Reach finance row exists.
DROP PROCEDURE IF EXISTS rollback_smart_reach_finance_20261113;
DELIMITER $$
CREATE PROCEDURE rollback_smart_reach_finance_20261113()
BEGIN
  IF (SELECT COUNT(*) FROM channel_smart_reach_impression_billings)<>0
    OR (SELECT COUNT(*) FROM channel_smart_reach_view_claims)<>0
    OR (SELECT COUNT(*) FROM channel_smart_reach_publisher_accounts)<>0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='smart_reach_financial_records_exist';
  END IF;
END$$
DELIMITER ;
CALL rollback_smart_reach_finance_20261113();
DROP PROCEDURE rollback_smart_reach_finance_20261113;
DROP TABLE channel_smart_reach_impression_billings;
DROP TABLE channel_smart_reach_view_claims;
DROP TABLE channel_smart_reach_publisher_accounts;
