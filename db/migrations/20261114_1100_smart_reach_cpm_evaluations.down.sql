DROP PROCEDURE IF EXISTS rollback_smart_reach_cpm_evaluations_20261114;
DELIMITER $$
CREATE PROCEDURE rollback_smart_reach_cpm_evaluations_20261114()
BEGIN
  IF (SELECT COUNT(*) FROM channel_smart_reach_cpm_evaluations)<>0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='smart_reach_cpm_history_exists';
  END IF;
END$$
DELIMITER ;
CALL rollback_smart_reach_cpm_evaluations_20261114();
DROP PROCEDURE rollback_smart_reach_cpm_evaluations_20261114;
DROP TABLE channel_smart_reach_cpm_evaluations;
