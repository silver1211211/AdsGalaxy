-- Permit the existing Bot lifecycle states used by pause, health checks, and resume.
-- This changes no existing values and does not affect delivery or financial processing.
SET @bot_status_sql = IF(
  EXISTS(
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'bots'
      AND COLUMN_NAME = 'status'
      AND COLUMN_TYPE LIKE 'enum%'
  ),
  'ALTER TABLE bots MODIFY COLUMN status VARCHAR(40) NOT NULL DEFAULT ''pending''',
  'SELECT 1'
);
PREPARE bot_status_stmt FROM @bot_status_sql;
EXECUTE bot_status_stmt;
DEALLOCATE PREPARE bot_status_stmt;
