-- AdsGalaxy Withdrawal Fraud Verification Tasks Table
CREATE TABLE IF NOT EXISTS `withdrawal_verification_tasks` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `withdrawal_id` INT NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'Queued',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `started_at` DATETIME NULL,
  `completed_at` DATETIME NULL,
  `lease_expires_at` DATETIME NULL,
  `worker_id` VARCHAR(64) NULL,
  `evidence_json` LONGTEXT NULL,
  INDEX `idx_withdrawal_id` (`withdrawal_id`),
  INDEX `idx_status_created` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
