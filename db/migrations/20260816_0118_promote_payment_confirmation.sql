ALTER TABLE publisher_promotion_campaigns
  ADD COLUMN payment_confirmation_reference VARCHAR(191) NULL AFTER paid_at,
  ADD COLUMN payment_confirmed_amount DECIMAL(24,8) NULL AFTER payment_confirmation_reference,
  ADD COLUMN payment_confirmed_by_admin_id INT NULL AFTER payment_confirmed_amount,
  ADD COLUMN payment_confirmed_at DATETIME(6) NULL AFTER payment_confirmed_by_admin_id,
  ADD COLUMN completion_expires_at DATETIME(6) NULL AFTER payment_confirmed_at;

ALTER TABLE publisher_promotion_payout_batches
  ADD COLUMN payment_reference VARCHAR(191) NULL AFTER reconciled_at,
  ADD COLUMN confirmed_amount DECIMAL(24,8) NULL AFTER payment_reference;
