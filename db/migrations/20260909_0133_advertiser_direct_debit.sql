ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS funding_model ENUM('legacy_reserved','direct_debit') NOT NULL DEFAULT 'legacy_reserved' AFTER billing_model,
  ADD INDEX IF NOT EXISTS idx_campaigns_funding_status (funding_model,status,user_id);

ALTER TABLE miniapp_rewarded_campaigns
  ADD COLUMN IF NOT EXISTS funding_model ENUM('legacy_reserved','direct_debit') NOT NULL DEFAULT 'direct_debit' AFTER campaign_budget_mode,
  ADD INDEX IF NOT EXISTS idx_miniapp_funding_status (funding_model,status,advertiser_id);

CREATE TABLE IF NOT EXISTS advertiser_direct_debits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(191) NOT NULL,
  advertiser_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  campaign_table ENUM('campaigns','miniapp_rewarded_campaigns') NOT NULL,
  billing_type ENUM('channel_view','channel_click','bot_delivery','miniapp_impression','miniapp_external','channel_growth') NOT NULL,
  amount DECIMAL(20,8) NOT NULL,
  status ENUM('claimed','settled') NOT NULL DEFAULT 'claimed',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_advertiser_direct_debit_source (source_key),
  KEY idx_advertiser_direct_debit_campaign (campaign_table,campaign_id,created_at),
  KEY idx_advertiser_direct_debit_user (advertiser_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS advertiser_campaign_reservation_release_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT NOT NULL,
  advertiser_id BIGINT NOT NULL,
  reservation_transaction_id BIGINT NOT NULL,
  released_amount DECIMAL(20,8) NOT NULL,
  source_basis VARCHAR(191) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reservation_release_campaign (campaign_id),
  UNIQUE KEY uq_reservation_release_transaction (reservation_transaction_id),
  KEY idx_reservation_release_user (advertiser_id,released_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

START TRANSACTION;

INSERT IGNORE INTO advertiser_campaign_reservation_release_ledger
  (campaign_id,advertiser_id,reservation_transaction_id,released_amount,source_basis)
SELECT c.id,c.user_id,atx.id,c.budget,'exact_creation_debit_name_amount_time'
FROM campaigns c
JOIN advertiser_transactions atx
  ON atx.user_id=c.user_id
 AND atx.type='debit'
 AND atx.amount=c.total_budget
 AND atx.description=CONCAT('Campaign Creation: ',c.name)
 AND ABS(TIMESTAMPDIFF(SECOND,atx.created_at,c.created_at))<=10
WHERE c.funding_model='legacy_reserved'
  AND c.budget>0
  AND (SELECT COUNT(*) FROM advertiser_transactions candidate
       WHERE candidate.user_id=c.user_id AND candidate.type='debit'
         AND candidate.amount=c.total_budget
         AND candidate.description=CONCAT('Campaign Creation: ',c.name)
         AND ABS(TIMESTAMPDIFF(SECOND,candidate.created_at,c.created_at))<=10)=1
  AND (SELECT COUNT(*) FROM campaigns candidate_campaign
       WHERE candidate_campaign.user_id=atx.user_id
         AND candidate_campaign.total_budget=atx.amount
         AND CONCAT('Campaign Creation: ',candidate_campaign.name)=atx.description
         AND ABS(TIMESTAMPDIFF(SECOND,candidate_campaign.created_at,atx.created_at))<=10)=1;

UPDATE users u
JOIN (
  SELECT advertiser_id,SUM(released_amount) amount
  FROM advertiser_campaign_reservation_release_ledger
  WHERE released_at IS NULL
  GROUP BY advertiser_id
) release_totals ON release_totals.advertiser_id=u.id
SET u.ad_balance=u.ad_balance+release_totals.amount;

INSERT INTO advertiser_transactions (user_id,amount,type,description)
SELECT advertiser_id,released_amount,'credit',CONCAT('One-time legacy campaign reservation release #',campaign_id)
FROM advertiser_campaign_reservation_release_ledger
WHERE released_at IS NULL;

UPDATE campaigns c
JOIN advertiser_campaign_reservation_release_ledger ledger ON ledger.campaign_id=c.id
SET c.funding_model='direct_debit';

UPDATE advertiser_campaign_reservation_release_ledger
SET released_at=NOW()
WHERE released_at IS NULL;

COMMIT;

UPDATE miniapp_rewarded_campaigns SET funding_model='direct_debit' WHERE funding_model='legacy_reserved';
