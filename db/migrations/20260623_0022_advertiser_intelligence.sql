-- Phase 11: Advertiser intelligence, forecasts, alerts, and export/audit scaffolding.
-- Additive only. Does not change payouts, withdrawals, fraud, CPM calculations,
-- conversion tracking logic, or inventory ranking logic.

CREATE TABLE IF NOT EXISTS advertiser_campaign_intelligence_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  advertiser_id INT NOT NULL,
  campaign_type VARCHAR(30) NULL,
  campaign_id BIGINT UNSIGNED NULL,
  range_start DATETIME NOT NULL,
  range_end DATETIME NOT NULL,
  health_score INT NOT NULL DEFAULT 0,
  health_tier VARCHAR(20) NOT NULL DEFAULT 'poor',
  metrics JSON NOT NULL,
  recommendations JSON NULL,
  alerts JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_adv_intel_snapshots_advertiser (advertiser_id, created_at),
  KEY idx_adv_intel_snapshots_campaign (campaign_type, campaign_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS advertiser_optimization_recommendations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  advertiser_id INT NOT NULL,
  campaign_type VARCHAR(30) NULL,
  campaign_id BIGINT UNSIGNED NULL,
  recommendation_type VARCHAR(60) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'info',
  title VARCHAR(180) NOT NULL,
  detail TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_adv_recommendations_advertiser (advertiser_id, status, created_at),
  KEY idx_adv_recommendations_campaign (campaign_type, campaign_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS advertiser_intelligence_alerts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  advertiser_id INT NOT NULL,
  campaign_type VARCHAR(30) NULL,
  campaign_id BIGINT UNSIGNED NULL,
  alert_type VARCHAR(60) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'info',
  title VARCHAR(180) NOT NULL,
  detail TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_adv_intel_alerts_advertiser (advertiser_id, status, created_at),
  KEY idx_adv_intel_alerts_campaign (campaign_type, campaign_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS advertiser_forecast_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  advertiser_id INT NOT NULL,
  campaign_type VARCHAR(30) NULL,
  campaign_id BIGINT UNSIGNED NULL,
  budget DECIMAL(18,8) NOT NULL DEFAULT 0,
  cpm DECIMAL(18,8) NOT NULL DEFAULT 0,
  targeting JSON NULL,
  forecast JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_adv_forecasts_advertiser (advertiser_id, created_at),
  KEY idx_adv_forecasts_campaign (campaign_type, campaign_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
