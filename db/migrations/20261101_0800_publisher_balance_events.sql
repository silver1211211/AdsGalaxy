-- Ordinary transactional balance-mutation ledger. This is NOT the protected
-- tamper-evident evidence store; the application DB user can still alter schema.
-- Install only after isolated integration/load tests and DBA privilege review.
CREATE TABLE IF NOT EXISTS publisher_balance_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  event_kind VARCHAR(32) NOT NULL,
  source_event_key VARCHAR(191) NULL,
  source_system VARCHAR(64) NULL,
  source_record_id VARCHAR(128) NULL,
  policy_version VARCHAR(96) NULL,
  available_before DECIMAL(20,8) NOT NULL,
  available_after DECIMAL(20,8) NOT NULL,
  locked_before DECIMAL(20,8) NOT NULL,
  locked_after DECIMAL(20,8) NOT NULL,
  delta_available DECIMAL(20,8) NOT NULL,
  delta_locked DECIMAL(20,8) NOT NULL,
  occurred_at DATETIME(6) NOT NULL,
  recorded_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_balance_event_source (source_event_key),
  KEY idx_balance_event_user_id (user_id,id),
  KEY idx_balance_event_recorded (recorded_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TRIGGER IF NOT EXISTS trg_publisher_balance_opened
AFTER INSERT ON users FOR EACH ROW
INSERT INTO publisher_balance_events
(user_id,event_kind,source_event_key,source_system,source_record_id,policy_version,
 available_before,available_after,locked_before,locked_after,delta_available,delta_locked,occurred_at)
VALUES
(NEW.id,'account_opened',CONCAT('account_opened:',NEW.id),'registration',CAST(NEW.id AS CHAR),'balance-events-v1',
 0,NEW.balance_available,0,NEW.balance_locked,NEW.balance_available,NEW.balance_locked,UTC_TIMESTAMP(6));

CREATE TRIGGER IF NOT EXISTS trg_publisher_balance_changed
AFTER UPDATE ON users FOR EACH ROW
INSERT INTO publisher_balance_events
(user_id,event_kind,source_event_key,source_system,source_record_id,policy_version,
 available_before,available_after,locked_before,locked_after,delta_available,delta_locked,occurred_at)
SELECT
 NEW.id,'balance_changed',
 CAST(@adsgalaxy_financial_source_key AS CHAR(191)),
 CAST(@adsgalaxy_financial_source_system AS CHAR(64)),
 CAST(@adsgalaxy_financial_source_record_id AS CHAR(128)),
 CAST(@adsgalaxy_financial_policy_version AS CHAR(96)),
 OLD.balance_available,NEW.balance_available,OLD.balance_locked,NEW.balance_locked,
 NEW.balance_available-OLD.balance_available,NEW.balance_locked-OLD.balance_locked,UTC_TIMESTAMP(6)
FROM DUAL
WHERE OLD.balance_available <> NEW.balance_available OR OLD.balance_locked <> NEW.balance_locked;

-- These guards prevent accidental rewriting through ordinary DML. They cannot
-- stop a privileged actor from dropping the triggers or altering the table.
CREATE TRIGGER IF NOT EXISTS trg_publisher_balance_events_no_update
BEFORE UPDATE ON publisher_balance_events FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='publisher_balance_events_append_only';

CREATE TRIGGER IF NOT EXISTS trg_publisher_balance_events_no_delete
BEFORE DELETE ON publisher_balance_events FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='publisher_balance_events_append_only';
