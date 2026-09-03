-- Preserve eight-decimal immutable referral reward precision in the legacy display cache.
ALTER TABLE users
  MODIFY COLUMN total_referral_earnings DECIMAL(24,8) NULL DEFAULT 0.00000000;

CREATE TABLE IF NOT EXISTS referral_reconciliation_audits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_key VARCHAR(191) NOT NULL,
  user_id INT NOT NULL,
  actor VARCHAR(64) NOT NULL,
  reward_count INT NOT NULL,
  debit DECIMAL(20,8) NOT NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_referral_reconciliation_operation (operation_key),
  KEY idx_referral_reconciliation_user (user_id, created_at),
  CONSTRAINT fk_referral_reconciliation_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
