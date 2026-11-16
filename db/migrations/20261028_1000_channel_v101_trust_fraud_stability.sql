-- ==============================================================================
-- Migration: 20261028_1000_channel_v101_trust_fraud_stability.sql
-- Project: AdsGalaxy V1.01 — Channel Earnings V1.01 (Phase 4)
-- Objective: Persistent 24-hour rolling audit for trust adjustments, fraud risk
--            increments, incident deduplication, and provisional holds.
--
-- STATUS: PREPARED ONLY. DO NOT EXECUTE AUTOMATICALLY IN PRODUCTION.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS channel_trust_score_adjustments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  channel_id INT NOT NULL,
  publisher_id INT NOT NULL,
  evaluation_id BIGINT NULL,
  old_score DECIMAL(7,4) NOT NULL,
  new_score DECIMAL(7,4) NOT NULL,
  score_delta DECIMAL(7,4) NOT NULL,
  is_routine TINYINT(1) NOT NULL DEFAULT 1,
  is_admin_override TINYINT(1) NOT NULL DEFAULT 0,
  evidence_post_count INT NOT NULL DEFAULT 0,
  adjustment_reason VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_channel_created (channel_id, created_at),
  INDEX idx_publisher_created (publisher_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS channel_fraud_risk_adjustments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  channel_id INT NOT NULL,
  publisher_id INT NOT NULL,
  evaluation_id BIGINT NULL,
  old_risk DECIMAL(7,4) NOT NULL,
  new_risk DECIMAL(7,4) NOT NULL,
  risk_delta DECIMAL(7,4) NOT NULL,
  deduplication_key VARCHAR(64) NULL,
  is_routine TINYINT(1) NOT NULL DEFAULT 1,
  adjustment_reason VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_channel_created (channel_id, created_at),
  INDEX idx_dedup (deduplication_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS channel_provisional_holds (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  channel_id INT NOT NULL,
  publisher_id INT NOT NULL,
  campaign_id INT NOT NULL,
  reason VARCHAR(255) NOT NULL,
  held_amount DECIMAL(18,8) NOT NULL DEFAULT 0.00000000,
  status ENUM('active','released','confirmed_fraud') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_post (post_id),
  INDEX idx_publisher_status (publisher_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
