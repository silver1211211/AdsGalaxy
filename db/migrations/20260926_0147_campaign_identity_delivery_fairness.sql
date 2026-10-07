-- Durable public campaign identity, analytics recovery, and delivery fairness.
-- Additive only. Existing financial rows are not modified.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS public_id INT UNSIGNED NULL AFTER id,
  ADD COLUMN IF NOT EXISTS channel_delivery_generation INT UNSIGNED NOT NULL DEFAULT 1 AFTER public_id;

CREATE TEMPORARY TABLE tmp_campaign_public_ids AS
SELECT c.id, ROW_NUMBER() OVER (ORDER BY c.id) AS public_id
FROM campaigns c
WHERE NOT EXISTS (
  SELECT 1 FROM campaign_admin_isolation cai
  WHERE cai.campaign_id=c.id AND cai.management_scope='silver'
);

UPDATE campaigns c
JOIN tmp_campaign_public_ids p ON p.id=c.id
SET c.public_id=COALESCE(c.public_id,p.public_id);

DROP TEMPORARY TABLE tmp_campaign_public_ids;

-- Pin the audited canonical identity explicitly.
UPDATE campaigns
SET public_id=60
WHERE id=64 AND user_id=149284 AND name='Views';

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaigns_public_id ON campaigns(public_id);

CREATE TABLE IF NOT EXISTS campaign_public_id_sequence (
  singleton TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  next_id INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO campaign_public_id_sequence(singleton,next_id)
SELECT 1,COALESCE(MAX(public_id),0)+1 FROM campaigns
ON DUPLICATE KEY UPDATE next_id=GREATEST(next_id,VALUES(next_id));

ALTER TABLE campaign_posts
  ADD COLUMN IF NOT EXISTS delivery_generation INT UNSIGNED NOT NULL DEFAULT 1 AFTER campaign_id,
  ADD COLUMN IF NOT EXISTS delivery_claim_key VARCHAR(160) NULL AFTER delivery_generation;

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_posts_delivery_claim
  ON campaign_posts(delivery_claim_key);

CREATE TABLE IF NOT EXISTS campaign_analytics_adjustments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id INT NOT NULL,
  metric ENUM('clicks') NOT NULL,
  quantity BIGINT UNSIGNED NOT NULL,
  adjustment_mode ENUM('baseline','additive') NOT NULL DEFAULT 'baseline',
  reason VARCHAR(160) NOT NULL,
  financial_effect DECIMAL(18,8) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  metadata JSON NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(id),
  UNIQUE KEY uq_campaign_analytics_adjustment(campaign_id,metric,reason),
  KEY idx_campaign_analytics_adjustment_lookup(campaign_id,metric,active),
  CONSTRAINT fk_campaign_analytics_adjustment_campaign FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_campaign_analytics_adjustment_admin FOREIGN KEY(created_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO campaign_analytics_adjustments
  (campaign_id,metric,quantity,adjustment_mode,reason,financial_effect,metadata)
SELECT id,'clicks',200,'baseline','historical_click_tracking_outage_recovery',0,
  JSON_OBJECT('public_campaign_id',60,'origin','platform_tracking_outage','approved_quantity',200)
FROM campaigns
WHERE public_id=60 AND user_id=149284 AND name='Views'
ON DUPLICATE KEY UPDATE quantity=VALUES(quantity),adjustment_mode='baseline',financial_effect=0,active=1,metadata=VALUES(metadata);

CREATE TABLE IF NOT EXISTS bot_broadcast_campaign_state (
  campaign_id INT NOT NULL PRIMARY KEY,
  last_selected_at DATETIME NULL,
  fairness_window_date DATE NULL,
  successful_deliveries_window INT UNSIGNED NOT NULL DEFAULT 0,
  failure_count_window INT UNSIGNED NOT NULL DEFAULT 0,
  cooldown_until DATETIME NULL,
  last_success_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_bot_campaign_state_campaign FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bot_delivery_ready_pool (
  bot_id INT NOT NULL PRIMARY KEY,
  active_audience_count INT UNSIGNED NOT NULL DEFAULT 0,
  audience_cursor INT UNSIGNED NOT NULL DEFAULT 0,
  last_selected_at DATETIME NULL,
  fairness_window_date DATE NULL,
  successful_deliveries_window INT UNSIGNED NOT NULL DEFAULT 0,
  consecutive_permanent_failures TINYINT UNSIGNED NOT NULL DEFAULT 0,
  cooldown_until DATETIME NULL,
  last_success_at DATETIME NULL,
  last_failure_at DATETIME NULL,
  ready TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_bot_ready_pool_bot FOREIGN KEY(bot_id) REFERENCES bots(id) ON DELETE CASCADE,
  KEY idx_bot_ready_pool_selection(ready,cooldown_until,successful_deliveries_window,last_selected_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO bot_delivery_ready_pool(bot_id,active_audience_count,ready)
SELECT b.id,COUNT(bu.id),COUNT(bu.id)>0
FROM bots b
LEFT JOIN bot_users bu ON bu.bot_id=b.id AND bu.is_active=TRUE AND bu.status='active' AND bu.chat_id IS NOT NULL AND bu.chat_id<>''
WHERE b.status='active' AND b.is_deleted=FALSE
GROUP BY b.id
ON DUPLICATE KEY UPDATE active_audience_count=VALUES(active_audience_count),ready=VALUES(ready);

ALTER TABLE broadcast_deliveries
  ADD COLUMN IF NOT EXISTS delivery_claim_key VARCHAR(190) NULL AFTER campaign_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_broadcast_delivery_claim
  ON broadcast_deliveries(delivery_claim_key);
