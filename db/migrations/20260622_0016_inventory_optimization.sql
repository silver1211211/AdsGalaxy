-- Phase 8: delivery optimization, inventory ranking, and smart allocation.
-- Additive only. Does not modify withdrawals, settlements, advertiser balances, publisher balances,
-- mini app approval workflow, or external network integrations.

ALTER TABLE miniapps
  ADD COLUMN IF NOT EXISTS inventory_score INT NOT NULL DEFAULT 50 AFTER traffic_quality_updated_at,
  ADD COLUMN IF NOT EXISTS inventory_rank VARCHAR(20) NOT NULL DEFAULT 'standard' AFTER inventory_score,
  ADD COLUMN IF NOT EXISTS inventory_override VARCHAR(20) NOT NULL DEFAULT 'none' AFTER inventory_rank,
  ADD COLUMN IF NOT EXISTS inventory_priority_multiplier DECIMAL(10,4) NOT NULL DEFAULT 1 AFTER inventory_override,
  ADD COLUMN IF NOT EXISTS inventory_notes VARCHAR(255) NULL AFTER inventory_priority_multiplier,
  ADD COLUMN IF NOT EXISTS inventory_updated_at DATETIME NULL AFTER inventory_notes;

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS inventory_score INT NOT NULL DEFAULT 50 AFTER traffic_quality_updated_at,
  ADD COLUMN IF NOT EXISTS inventory_rank VARCHAR(20) NOT NULL DEFAULT 'standard' AFTER inventory_score,
  ADD COLUMN IF NOT EXISTS inventory_override VARCHAR(20) NOT NULL DEFAULT 'none' AFTER inventory_rank,
  ADD COLUMN IF NOT EXISTS inventory_priority_multiplier DECIMAL(10,4) NOT NULL DEFAULT 1 AFTER inventory_override,
  ADD COLUMN IF NOT EXISTS inventory_notes VARCHAR(255) NULL AFTER inventory_priority_multiplier,
  ADD COLUMN IF NOT EXISTS inventory_updated_at DATETIME NULL AFTER inventory_notes;

ALTER TABLE bots
  ADD COLUMN IF NOT EXISTS inventory_score INT NOT NULL DEFAULT 50 AFTER traffic_quality_updated_at,
  ADD COLUMN IF NOT EXISTS inventory_rank VARCHAR(20) NOT NULL DEFAULT 'standard' AFTER inventory_score,
  ADD COLUMN IF NOT EXISTS inventory_override VARCHAR(20) NOT NULL DEFAULT 'none' AFTER inventory_rank,
  ADD COLUMN IF NOT EXISTS inventory_priority_multiplier DECIMAL(10,4) NOT NULL DEFAULT 1 AFTER inventory_override,
  ADD COLUMN IF NOT EXISTS inventory_notes VARCHAR(255) NULL AFTER inventory_priority_multiplier,
  ADD COLUMN IF NOT EXISTS inventory_updated_at DATETIME NULL AFTER inventory_notes;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS advertiser_performance_score INT NOT NULL DEFAULT 50 AFTER quality_metadata,
  ADD COLUMN IF NOT EXISTS campaign_priority_score INT NOT NULL DEFAULT 50 AFTER advertiser_performance_score,
  ADD COLUMN IF NOT EXISTS delivery_quality_rating VARCHAR(20) NOT NULL DEFAULT 'good' AFTER campaign_priority_score;

ALTER TABLE miniapp_rewarded_campaigns
  ADD COLUMN IF NOT EXISTS advertiser_performance_score INT NOT NULL DEFAULT 50 AFTER quality_metadata,
  ADD COLUMN IF NOT EXISTS campaign_priority_score INT NOT NULL DEFAULT 50 AFTER advertiser_performance_score,
  ADD COLUMN IF NOT EXISTS delivery_quality_rating VARCHAR(20) NOT NULL DEFAULT 'good' AFTER campaign_priority_score;

ALTER TABLE campaign_delivery_events
  ADD COLUMN IF NOT EXISTS reason VARCHAR(255) NULL AFTER score;

CREATE TABLE IF NOT EXISTS inventory_quality_daily_scores (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type VARCHAR(20) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  date DATE NOT NULL,
  inventory_score INT NOT NULL DEFAULT 50,
  inventory_rank VARCHAR(20) NOT NULL DEFAULT 'standard',
  traffic_quality_score INT NOT NULL DEFAULT 60,
  fraud_risk_level VARCHAR(20) NOT NULL DEFAULT 'low',
  fill_rate DECIMAL(10,6) NOT NULL DEFAULT 0,
  delivery_consistency DECIMAL(10,6) NOT NULL DEFAULT 0,
  revenue_7d DECIMAL(18,8) NOT NULL DEFAULT 0,
  impressions_7d BIGINT NOT NULL DEFAULT 0,
  ctr DECIMAL(10,6) NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_inventory_quality_daily (entity_type, entity_id, date),
  KEY idx_inventory_quality_score (entity_type, inventory_score, inventory_rank),
  KEY idx_inventory_quality_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_attention_queue (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type VARCHAR(20) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  inventory_score INT NOT NULL,
  inventory_rank VARCHAR(20) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  reviewed_by INT NULL,
  PRIMARY KEY (id),
  KEY idx_inventory_attention_status (status, inventory_score, created_at),
  KEY idx_inventory_attention_entity (entity_type, entity_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO settings (`key`, value) VALUES
  ('delivery_optimization_mode', 'balanced'),
  ('delivery_exploration_allocation_percent', '10'),
  ('delivery_elite_inventory_boost', '1.2'),
  ('delivery_manual_quality_weight', '0.35'),
  ('delivery_manual_revenue_weight', '0.20'),
  ('delivery_manual_consistency_weight', '0.15'),
  ('delivery_manual_exploration_weight', '0.10'),
  ('delivery_manual_override_weight', '0.20'),
  ('inventory_attention_threshold', '40'),
  ('last_inventory_optimization_cron_run', '0')
ON DUPLICATE KEY UPDATE value = value;
