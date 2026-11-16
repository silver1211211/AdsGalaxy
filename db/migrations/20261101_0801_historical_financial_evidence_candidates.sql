-- Candidate records only. No balance mutation or claim of independent integrity.
-- Apply only after isolated verification and production backup.
CREATE TABLE IF NOT EXISTS historical_financial_evidence_candidates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  source_event_key VARCHAR(191) NOT NULL,
  user_id INT NOT NULL,
  source_table VARCHAR(64) NOT NULL,
  source_record_id BIGINT UNSIGNED NOT NULL,
  source_occurred_at DATETIME NULL,
  imported_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  amount DECIMAL(20,8) NOT NULL,
  currency CHAR(4) NOT NULL DEFAULT 'USDT',
  provenance_quality ENUM('source_row','source_row_with_linked_debit') NOT NULL,
  verification_confidence ENUM('unverified','partial','verified') NOT NULL DEFAULT 'unverified',
  review_status ENUM('candidate','rejected','approved') NOT NULL DEFAULT 'candidate',
  missing_evidence VARCHAR(255) NOT NULL,
  source_row_sha256 CHAR(64) NOT NULL,
  UNIQUE KEY uq_historical_source (source_event_key),
  UNIQUE KEY uq_historical_row (source_table,source_record_id),
  KEY idx_historical_user (user_id,id),
  KEY idx_historical_review (review_status,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
