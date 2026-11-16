-- Task 5B-1B(i): structure only. No wallet or publisher balance writes.
-- Refuse to reinterpret already credited Smart Reach rows without allocation evidence.
DROP PROCEDURE IF EXISTS preflight_smart_reach_allocations_20261113;
DELIMITER $$
CREATE PROCEDURE preflight_smart_reach_allocations_20261113()
BEGIN
  IF (SELECT COUNT(*) FROM channel_smart_reach_impression_billings WHERE publisher_funding<>0)<>0
    OR (SELECT COUNT(*) FROM channel_smart_reach_view_claims WHERE funded_amount<>0)<>0
    OR (SELECT COUNT(*) FROM channel_smart_reach_publisher_accounts WHERE funded_amount<>0)<>0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='smart_reach_existing_funding_requires_reconciliation';
  END IF;
END$$
DELIMITER ;
CALL preflight_smart_reach_allocations_20261113();
DROP PROCEDURE preflight_smart_reach_allocations_20261113;

ALTER TABLE channel_smart_reach_impression_billings
  ADD UNIQUE KEY uq_smart_billing_funding_identity (id,campaign_id,publisher_id);
ALTER TABLE channel_smart_reach_view_claims
  ADD UNIQUE KEY uq_smart_claim_funding_identity (id,campaign_id,publisher_id);

CREATE TABLE channel_smart_reach_funding_allocations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  billing_event_id BIGINT UNSIGNED NOT NULL,
  claim_id BIGINT UNSIGNED NOT NULL,
  campaign_id INT NOT NULL,
  publisher_id INT NOT NULL,
  amount DECIMAL(24,8) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  funding_source ENUM('advertiser_impression') NOT NULL DEFAULT 'advertiser_impression',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_smart_funding_key (idempotency_key),
  UNIQUE KEY uq_smart_funding_pair (billing_event_id,claim_id),
  KEY ix_smart_funding_claim (claim_id,id),
  KEY ix_smart_funding_campaign_publisher (campaign_id,publisher_id,id),
  CONSTRAINT fk_smart_funding_billing FOREIGN KEY (billing_event_id,campaign_id,publisher_id)
    REFERENCES channel_smart_reach_impression_billings(id,campaign_id,publisher_id) ON DELETE RESTRICT,
  CONSTRAINT fk_smart_funding_claim FOREIGN KEY (claim_id,campaign_id,publisher_id)
    REFERENCES channel_smart_reach_view_claims(id,campaign_id,publisher_id) ON DELETE RESTRICT,
  CONSTRAINT chk_smart_funding_positive CHECK (amount>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Later service transaction contract:
-- 1. Lock campaigns.id, then the relevant campaign_posts.id values in ascending order.
-- 2. Lock channel_smart_reach_publisher_accounts(campaign_id,publisher_id).
-- 3. Lock billing event rows and claim rows in ascending ID order before SUM queries.
-- 4. Calculate unused event publisher_pool_amount - SUM(allocations.amount) and
--    claim entitled_amount - SUM(allocations.amount) from these locked rows.
-- 5. Insert allocation(s), update funded/pending summaries and credit the existing
--    publisher balance in the same transaction; rollback on any failed invariant.
-- Every competing allocation for one publisher must use this stable account lock.
