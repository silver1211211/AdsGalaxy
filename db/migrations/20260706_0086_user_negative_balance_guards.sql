-- Defense-in-depth guard against negative user balances.
-- Uses triggers instead of CHECK constraints for safer MySQL/MariaDB compatibility.

UPDATE users
SET
  balance_available = GREATEST(COALESCE(balance_available, 0), 0),
  balance_locked = GREATEST(COALESCE(balance_locked, 0), 0),
  ad_balance = GREATEST(COALESCE(ad_balance, 0), 0);

DROP TRIGGER IF EXISTS users_prevent_negative_balances_insert;
DROP TRIGGER IF EXISTS users_prevent_negative_balances_update;

DELIMITER $$

CREATE TRIGGER users_prevent_negative_balances_insert
BEFORE INSERT ON users
FOR EACH ROW
BEGIN
  IF COALESCE(NEW.balance_available, 0) < 0
    OR COALESCE(NEW.balance_locked, 0) < 0
    OR COALESCE(NEW.ad_balance, 0) < 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'negative_user_balance_blocked';
  END IF;
END$$

CREATE TRIGGER users_prevent_negative_balances_update
BEFORE UPDATE ON users
FOR EACH ROW
BEGIN
  IF COALESCE(NEW.balance_available, 0) < 0
    OR COALESCE(NEW.balance_locked, 0) < 0
    OR COALESCE(NEW.ad_balance, 0) < 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'negative_user_balance_blocked';
  END IF;
END$$

DELIMITER ;
