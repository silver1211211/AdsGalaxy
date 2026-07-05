-- Prompt 5: hourly Mini App revenue optimizer.
-- Additive only. Does not alter settlement, billing, payout, reserve, or SDK tables.

CREATE TABLE IF NOT EXISTS miniapp_revenue_optimizer_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(30) NOT NULL DEFAULT 'success',
  recommended_cpm DECIMAL(18,8) NOT NULL DEFAULT 0,
  previous_recommended_cpm DECIMAL(18,8) NOT NULL DEFAULT 0,
  applied_recommended_cpm DECIMAL(18,8) NOT NULL DEFAULT 0,
  min_cpm DECIMAL(18,8) NOT NULL DEFAULT 0,
  max_cpm DECIMAL(18,8) NOT NULL DEFAULT 0,
  manual_override TINYINT(1) NOT NULL DEFAULT 0,
  reason VARCHAR(255) NULL,
  metrics JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_miniapp_revenue_optimizer_runs_created (created_at),
  KEY idx_miniapp_revenue_optimizer_runs_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS miniapp_network_optimizer_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id BIGINT UNSIGNED NULL,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  network_name VARCHAR(50) NOT NULL,
  score DECIMAL(10,4) NOT NULL DEFAULT 0,
  rank_position INT NOT NULL DEFAULT 99,
  previous_priority INT NULL,
  recommended_priority INT NOT NULL DEFAULT 99,
  applied_priority INT NOT NULL DEFAULT 99,
  health_score DECIMAL(10,4) NOT NULL DEFAULT 0,
  effective_network_cpm DECIMAL(18,8) NOT NULL DEFAULT 0,
  effective_publisher_cpm DECIMAL(18,8) NOT NULL DEFAULT 0,
  fill_rate DECIMAL(10,6) NOT NULL DEFAULT 0,
  ctr DECIMAL(10,6) NOT NULL DEFAULT 0,
  completion_rate DECIMAL(10,6) NOT NULL DEFAULT 0,
  failure_rate DECIMAL(10,6) NOT NULL DEFAULT 0,
  timeout_rate DECIMAL(10,6) NOT NULL DEFAULT 0,
  revenue_quality DECIMAL(10,6) NOT NULL DEFAULT 0,
  metrics JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_miniapp_network_optimizer_latest (miniapp_id, network_name, created_at),
  KEY idx_miniapp_network_optimizer_run (run_id),
  CONSTRAINT fk_miniapp_network_optimizer_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO settings (`key`, value, description) VALUES
  ('global_min_cpm', '0.50', 'Global minimum CPM used across Mini App, Channel, Bot, and all categories.'),
  ('global_recommended_cpm', '1.00', 'Global recommended CPM shown as the default bid unless manually overridden.'),
  ('global_max_cpm', '5.00', 'Global maximum CPM used across Mini App, Channel, Bot, and all categories.'),
  ('global_recommended_cpm_optimizer_value', '1.00', 'Latest CPM recommendation calculated by the hourly optimizer.'),
  ('global_recommended_cpm_manual_override', '0', 'When 1, hourly optimizer records recommendations but does not replace the active recommended CPM.'),
  ('miniapp_revenue_optimizer_enabled', '1', 'Enable hourly Mini App revenue optimizer.'),
  ('last_miniapp_revenue_optimizer_run', '0', 'Timestamp of last Mini App revenue optimizer cron run.')
ON DUPLICATE KEY UPDATE value = value;

UPDATE settings
SET value = COALESCE((SELECT v FROM (SELECT value AS v FROM settings WHERE `key` = 'miniapp_internal_min_cpm' LIMIT 1) legacy), value)
WHERE `key` = 'global_min_cpm'
  AND value = '0.50';

UPDATE settings
SET value = COALESCE((SELECT v FROM (SELECT value AS v FROM settings WHERE `key` = 'miniapp_internal_recommended_cpm' LIMIT 1) legacy), value)
WHERE `key` = 'global_recommended_cpm'
  AND value = '1.00';

UPDATE settings
SET value = COALESCE((SELECT v FROM (SELECT value AS v FROM settings WHERE `key` = 'miniapp_internal_max_cpm' LIMIT 1) legacy), value)
WHERE `key` = 'global_max_cpm'
  AND value = '5.00';
