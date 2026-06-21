-- Ledger markers for reversible admin withdrawal actions.
-- Safe to re-run on MariaDB; MySQL installs should check INFORMATION_SCHEMA first.

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS paid_out TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_at DATETIME NULL;

UPDATE withdrawals
SET paid_out = 1,
    paid_at = COALESCE(paid_at, NOW())
WHERE status = 'success'
  AND paid_out = 0;
