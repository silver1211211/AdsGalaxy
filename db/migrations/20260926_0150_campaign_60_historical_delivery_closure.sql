-- Campaign public #60 / internal #64 historical placement closure.
-- Only generation 1 posts at or below the audited cutoff are waived. Newer
-- delivery generations remain eligible for normal real delivery and billing.

CREATE TABLE IF NOT EXISTS campaign_historical_delivery_closures (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id INT NOT NULL,
  delivery_generation INT UNSIGNED NOT NULL,
  max_post_id INT NOT NULL,
  raw_views BIGINT UNSIGNED NOT NULL,
  fraud_excluded_views BIGINT UNSIGNED NOT NULL,
  billable_views BIGINT UNSIGNED NOT NULL,
  waived_views BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(160) NOT NULL,
  financial_effect DECIMAL(18,8) NOT NULL DEFAULT 0,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(id),
  UNIQUE KEY uq_campaign_historical_delivery_closure(campaign_id,delivery_generation,reason),
  CONSTRAINT fk_historical_delivery_closure_campaign FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  CONSTRAINT chk_historical_delivery_closure_financial_zero CHECK(financial_effect=0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fail closed before touching campaign state if the canonical identity moved.
CREATE TEMPORARY TABLE campaign_60_identity_assertion (
  matches_expected INT NOT NULL,
  CONSTRAINT chk_campaign_60_identity CHECK(matches_expected=1)
);
INSERT INTO campaign_60_identity_assertion(matches_expected)
SELECT COUNT(*) FROM campaigns
WHERE id=64 AND public_id=60 AND user_id=149284 AND name='Views' AND type='views';
DROP TEMPORARY TABLE campaign_60_identity_assertion;

INSERT INTO channel_view_waivers
  (campaign_id,post_id,waived_views,reason,financial_effect,metadata)
SELECT cp.campaign_id,cp.id,
  GREATEST(COALESCE(cp.views,0)-COALESCE(cp.settled_views,0)
    -COALESCE((SELECT SUM(existing.waived_views) FROM channel_view_waivers existing WHERE existing.post_id=cp.id),0),0),
  'historical_campaign_60_old_placement_full_waiver',0,
  JSON_OBJECT('public_campaign_id',60,'delivery_generation',COALESCE(cp.delivery_generation,1),
    'raw_views_at_closure',COALESCE(cp.views,0),'fraud_excluded_views_at_closure',COALESCE(cp.fraud_excluded_views,0),
    'settled_views_at_closure',COALESCE(cp.settled_views,0),'origin','historical_delivery_cleanup')
FROM campaign_posts cp
WHERE cp.campaign_id=64 AND cp.delivery_generation=1 AND cp.id<=92788
  AND GREATEST(COALESCE(cp.views,0)-COALESCE(cp.settled_views,0)
    -COALESCE((SELECT SUM(existing.waived_views) FROM channel_view_waivers existing WHERE existing.post_id=cp.id),0),0)>0
ON DUPLICATE KEY UPDATE financial_effect=0,metadata=VALUES(metadata);

INSERT INTO campaign_historical_delivery_closures
  (campaign_id,delivery_generation,max_post_id,raw_views,fraud_excluded_views,billable_views,waived_views,reason,financial_effect,metadata)
SELECT 64,1,92788,
  COALESCE(SUM(cp.views),0),COALESCE(SUM(cp.fraud_excluded_views),0),8064,
  COALESCE((SELECT SUM(cvw.waived_views) FROM channel_view_waivers cvw WHERE cvw.campaign_id=64),0),
  'historical_campaign_60_old_placement_closure',0,
  JSON_OBJECT('public_campaign_id',60,'future_generations_bill_normally',TRUE)
FROM campaign_posts cp
WHERE cp.campaign_id=64 AND cp.delivery_generation=1 AND cp.id<=92788
ON DUPLICATE KEY UPDATE max_post_id=VALUES(max_post_id),raw_views=VALUES(raw_views),
  fraud_excluded_views=VALUES(fraud_excluded_views),billable_views=VALUES(billable_views),
  waived_views=VALUES(waived_views),financial_effect=0,metadata=VALUES(metadata);

-- The recovery is additive to future real tracked clicks, never billable.
UPDATE campaign_analytics_adjustments
SET quantity=200,adjustment_mode='additive',financial_effect=0,active=1,
  metadata=JSON_OBJECT('public_campaign_id',60,'origin','platform_tracking_outage','future_actual_clicks_additive',TRUE)
WHERE campaign_id=64 AND metric='clicks'
  AND reason='historical_click_tracking_outage_recovery';

UPDATE campaigns
SET status='daily_cap_reached',pause_reason='daily_budget_limit',
  paused_at=COALESCE(paused_at,NOW()),daily_cap_reached_at=COALESCE(daily_cap_reached_at,NOW()),
  daily_cap_billing_date=CURDATE()
WHERE id=64 AND public_id=60 AND user_id=149284 AND type='views';

-- Historical invariant only. Future posts use IDs above the cutoff and do not
-- participate in this closure or its waiver total.
CREATE TEMPORARY TABLE campaign_60_historical_view_assertion (
  outstanding_views BIGINT NOT NULL,
  CONSTRAINT chk_campaign_60_no_historical_outstanding CHECK(outstanding_views=0)
);
INSERT INTO campaign_60_historical_view_assertion(outstanding_views)
SELECT COALESCE(SUM(GREATEST(COALESCE(cp.views,0)-COALESCE(cp.settled_views,0)
  -COALESCE((SELECT SUM(cvw.waived_views) FROM channel_view_waivers cvw WHERE cvw.post_id=cp.id),0),0)),0)
FROM campaign_posts cp
WHERE cp.campaign_id=64 AND cp.delivery_generation=1 AND cp.id<=92788;
DROP TEMPORARY TABLE campaign_60_historical_view_assertion;
