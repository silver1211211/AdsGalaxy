-- Production schema repair for campaign creation, billing, settlement, and reconciliation.
-- Additive and repeatable: no production table or row is dropped, deleted, truncated, or renamed.

-- Tables introduced by the fast-debit and external-reconciliation releases.
CREATE TABLE IF NOT EXISTS channel_advertiser_debits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_key VARCHAR(160) NOT NULL,
  settlement_type ENUM('click','view') NOT NULL,
  campaign_id INT NOT NULL,
  post_id INT NOT NULL,
  channel_id INT NOT NULL,
  publisher_id INT NOT NULL,
  units BIGINT UNSIGNED NOT NULL,
  unit_price DECIMAL(18,8) NOT NULL,
  advertiser_debit DECIMAL(18,8) NOT NULL,
  publisher_status ENUM('pending','settled') NOT NULL DEFAULT 'pending',
  publisher_credit DECIMAL(18,8) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  publisher_settled_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_channel_fast_debit_source (source_key),
  KEY idx_channel_fast_debit_pending (publisher_status, created_at),
  KEY idx_channel_fast_debit_campaign_date (campaign_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS miniapp_internal_publisher_settlements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  impression_id BIGINT UNSIGNED NOT NULL,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  publisher_id INT NOT NULL,
  publisher_revenue DECIMAL(18,8) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'locked',
  stats_applied TINYINT(1) NOT NULL DEFAULT 0,
  settled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_miniapp_internal_publisher_impression (impression_id),
  KEY idx_miniapp_internal_publisher_owner (publisher_id, settled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS miniapp_external_reconciliation_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'success',
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
  records_fetched INT UNSIGNED NOT NULL DEFAULT 0,
  records_updated INT UNSIGNED NOT NULL DEFAULT 0,
  records_skipped INT UNSIGNED NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  metadata JSON NULL,
  PRIMARY KEY (id),
  KEY idx_miniapp_external_reconciliation_provider (provider, started_at),
  KEY idx_miniapp_external_reconciliation_status (status, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS miniapp_external_revenue_reconciliations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider VARCHAR(50) NOT NULL,
  provider_record_id VARCHAR(255) NOT NULL,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  daily_stat_id BIGINT UNSIGNED NOT NULL,
  network_name VARCHAR(50) NOT NULL,
  date DATE NOT NULL,
  previous_gross_revenue DECIMAL(18,8) NOT NULL DEFAULT 0,
  previous_publisher_revenue DECIMAL(18,8) NOT NULL DEFAULT 0,
  reconciled_gross_revenue DECIMAL(18,8) NOT NULL DEFAULT 0,
  reconciled_publisher_revenue DECIMAL(18,8) NOT NULL DEFAULT 0,
  gross_revenue_delta DECIMAL(18,8) NOT NULL DEFAULT 0,
  publisher_revenue_delta DECIMAL(18,8) NOT NULL DEFAULT 0,
  impressions BIGINT UNSIGNED NULL,
  clicks BIGINT UNSIGNED NULL,
  completed_views BIGINT UNSIGNED NULL,
  fill_rate DECIMAL(10,6) NULL,
  effective_cpm DECIMAL(18,8) NULL,
  settlement_status VARCHAR(30) NOT NULL DEFAULT 'unsettled',
  action VARCHAR(30) NOT NULL DEFAULT 'applied',
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_miniapp_external_provider_record (provider, provider_record_id),
  KEY idx_miniapp_external_revenue_stat (daily_stat_id, created_at),
  KEY idx_miniapp_external_revenue_provider_date (provider, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A metadata-driven column contract keeps partial deployments repairable without
-- relying on ADD COLUMN IF NOT EXISTS (not portable across supported servers).
CREATE TEMPORARY TABLE schema_repair_required_columns (
  table_name VARCHAR(64) NOT NULL,
  column_name VARCHAR(64) NOT NULL,
  column_definition TEXT NOT NULL,
  PRIMARY KEY (table_name, column_name)
);

INSERT INTO schema_repair_required_columns VALUES
  ('campaigns','postback_url','TEXT NULL'),
  ('campaigns','total_budget','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('campaigns','quality_score','INT NOT NULL DEFAULT 50'),
  ('campaigns','quality_tier','VARCHAR(20) NOT NULL DEFAULT ''average'''),
  ('campaigns','quality_metadata','JSON NULL'),
  ('campaigns','continents','TEXT NULL'),
  ('campaigns','countries','JSON NULL'),
  ('campaigns','languages','JSON NULL'),
  ('campaigns','vpn_policy','VARCHAR(30) NOT NULL DEFAULT ''allow_all'''),
  ('campaigns','device_policy','VARCHAR(30) NOT NULL DEFAULT ''all'''),
  ('campaigns','os_policy','VARCHAR(30) NOT NULL DEFAULT ''all'''),
  ('campaigns','start_at','DATETIME NULL'),
  ('campaigns','end_at','DATETIME NULL'),
  ('campaigns','daily_budget_limit','DECIMAL(18,8) NULL'),
  ('campaigns','frequency_cap_per_user','INT NULL'),
  ('campaigns','direct_placement_mode','VARCHAR(20) NOT NULL DEFAULT ''network'''),
  ('campaigns','direct_inventory_scope','VARCHAR(20) NOT NULL DEFAULT ''network'''),
  ('campaigns','direct_inventory_metadata','JSON NULL'),
  ('campaigns','rejection_reason','TEXT NULL'),
  ('campaigns','budget_exhausted_at','DATETIME NULL'),
  ('campaigns','pause_reason','VARCHAR(255) NULL'),
  ('campaigns','channel_spend','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('campaigns','channel_publisher_earnings','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('campaigns','channel_platform_revenue','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('campaigns','channel_reserve_amount','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('campaigns','updated_at','DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),

  ('miniapp_rewarded_campaigns','quality_score','INT NOT NULL DEFAULT 50'),
  ('miniapp_rewarded_campaigns','quality_tier','VARCHAR(20) NOT NULL DEFAULT ''average'''),
  ('miniapp_rewarded_campaigns','quality_metadata','JSON NULL'),
  ('miniapp_rewarded_campaigns','description','TEXT NULL'),
  ('miniapp_rewarded_campaigns','cta_text','VARCHAR(60) NOT NULL DEFAULT ''Learn More'''),
  ('miniapp_rewarded_campaigns','title_color','VARCHAR(20) NULL'),
  ('miniapp_rewarded_campaigns','body_color','VARCHAR(20) NULL'),
  ('miniapp_rewarded_campaigns','categories','JSON NULL'),
  ('miniapp_rewarded_campaigns','image_url','TEXT NULL'),
  ('miniapp_rewarded_campaigns','logo_url','TEXT NULL'),
  ('miniapp_rewarded_campaigns','postback_url','TEXT NULL'),
  ('miniapp_rewarded_campaigns','remaining_budget','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('miniapp_rewarded_campaigns','total_spend','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('miniapp_rewarded_campaigns','impressions','BIGINT UNSIGNED NOT NULL DEFAULT 0'),
  ('miniapp_rewarded_campaigns','advertiser_cpm_bid','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('miniapp_rewarded_campaigns','required_cpm','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('miniapp_rewarded_campaigns','campaign_budget_mode','VARCHAR(20) NOT NULL DEFAULT ''custom'''),
  ('miniapp_rewarded_campaigns','daily_budget_mode','VARCHAR(20) NOT NULL DEFAULT ''custom'''),
  ('miniapp_rewarded_campaigns','countries','JSON NULL'),
  ('miniapp_rewarded_campaigns','languages','JSON NULL'),
  ('miniapp_rewarded_campaigns','vpn_policy','VARCHAR(30) NOT NULL DEFAULT ''allow_all'''),
  ('miniapp_rewarded_campaigns','device_policy','VARCHAR(30) NOT NULL DEFAULT ''all'''),
  ('miniapp_rewarded_campaigns','os_policy','VARCHAR(30) NOT NULL DEFAULT ''all'''),
  ('miniapp_rewarded_campaigns','start_at','DATETIME NULL'),
  ('miniapp_rewarded_campaigns','end_at','DATETIME NULL'),
  ('miniapp_rewarded_campaigns','daily_budget_limit','DECIMAL(18,8) NULL'),
  ('miniapp_rewarded_campaigns','frequency_cap_per_user','INT NULL'),
  ('miniapp_rewarded_campaigns','direct_placement_mode','VARCHAR(20) NOT NULL DEFAULT ''network'''),
  ('miniapp_rewarded_campaigns','direct_inventory_scope','VARCHAR(20) NOT NULL DEFAULT ''network'''),
  ('miniapp_rewarded_campaigns','direct_inventory_metadata','JSON NULL'),
  ('miniapp_rewarded_campaigns','pause_reason','VARCHAR(64) NULL'),
  ('miniapp_rewarded_campaigns','creative_review_status','VARCHAR(30) NOT NULL DEFAULT ''pending'''),
  ('miniapp_rewarded_campaigns','requires_re_moderation','TINYINT(1) NOT NULL DEFAULT 0'),
  ('miniapp_rewarded_campaigns','previously_approved_at','DATETIME NULL'),
  ('miniapp_rewarded_campaigns','creative_review_notes','TEXT NULL'),
  ('miniapp_rewarded_campaigns','landing_review_flags','JSON NULL'),
  ('miniapp_rewarded_campaigns','image_review_metadata','JSON NULL'),

  ('campaign_posts','views','INT UNSIGNED NOT NULL DEFAULT 0'),
  ('campaign_posts','delivery_confirmed_at','DATETIME NULL'),
  ('campaign_posts','delivery_failed_at','DATETIME NULL'),
  ('campaign_posts','posting_mode','VARCHAR(30) NOT NULL DEFAULT ''scheduled'''),
  ('campaign_posts','posting_slot_date','DATE NULL'),
  ('campaign_posts','posting_slot_time','TIME NULL'),
  ('campaign_posts','deleted_at','DATETIME NULL'),
  ('campaign_posts','delete_attempts','INT NOT NULL DEFAULT 0'),
  ('campaign_posts','delete_failed_reason','TEXT NULL'),
  ('campaign_posts','delete_failed_at','DATETIME NULL'),
  ('campaign_posts','spend','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('campaign_posts','publisher_earnings','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('campaign_posts','platform_revenue','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('campaign_posts','reserve_amount','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('campaign_posts','settled_clicks','INT NOT NULL DEFAULT 0'),
  ('campaign_posts','settled_views','INT NOT NULL DEFAULT 0'),

  ('broadcast_deliveries','cost','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('broadcast_deliveries','publisher_reward','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('broadcast_deliveries','publisher_settled_at','DATETIME NULL'),
  ('broadcast_deliveries','status','VARCHAR(50) NULL DEFAULT ''pending'''),
  ('broadcast_deliveries','failure_reason','VARCHAR(255) NULL'),
  ('broadcast_deliveries','telegram_error','VARCHAR(500) NULL'),
  ('broadcast_deliveries','retry_count','INT UNSIGNED NOT NULL DEFAULT 0'),
  ('broadcast_deliveries','last_success_at','DATETIME NULL'),
  ('broadcast_deliveries','last_failure_at','DATETIME NULL'),

  ('miniapp_daily_stats','provider_reported_impressions','BIGINT UNSIGNED NULL'),
  ('miniapp_daily_stats','provider_reported_clicks','BIGINT UNSIGNED NULL'),
  ('miniapp_daily_stats','provider_reported_completed_views','BIGINT UNSIGNED NULL'),
  ('miniapp_daily_stats','provider_reported_fill_rate','DECIMAL(10,6) NULL'),
  ('miniapp_daily_stats','provider_reported_effective_cpm','DECIMAL(18,8) NULL'),
  ('miniapp_daily_stats','reconciliation_status','VARCHAR(30) NOT NULL DEFAULT ''estimated'''),
  ('miniapp_daily_stats','reconciliation_metadata','JSON NULL'),
  ('miniapp_daily_stats','reconciled_at','DATETIME NULL'),

  ('miniapps','telegram_bot_id','DECIMAL(20,0) UNSIGNED NULL'),
  ('miniapps','admin_approved_at','DATETIME NULL'),
  ('miniapps','admin_approved_by','INT NULL'),
  ('miniapps','is_deleted','TINYINT(1) NOT NULL DEFAULT 0'),

  ('channel_advertiser_debits','source_key','VARCHAR(160) NULL'),
  ('channel_advertiser_debits','settlement_type','ENUM(''click'',''view'') NULL'),
  ('channel_advertiser_debits','campaign_id','INT NULL'),
  ('channel_advertiser_debits','post_id','INT NULL'),
  ('channel_advertiser_debits','channel_id','INT NULL'),
  ('channel_advertiser_debits','publisher_id','INT NULL'),
  ('channel_advertiser_debits','units','BIGINT UNSIGNED NOT NULL DEFAULT 0'),
  ('channel_advertiser_debits','unit_price','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('channel_advertiser_debits','advertiser_debit','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('channel_advertiser_debits','publisher_status','ENUM(''pending'',''settled'') NOT NULL DEFAULT ''pending'''),
  ('channel_advertiser_debits','publisher_credit','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('channel_advertiser_debits','created_at','DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'),
  ('channel_advertiser_debits','publisher_settled_at','DATETIME NULL'),

  ('miniapp_internal_publisher_settlements','impression_id','BIGINT UNSIGNED NULL'),
  ('miniapp_internal_publisher_settlements','miniapp_id','BIGINT UNSIGNED NULL'),
  ('miniapp_internal_publisher_settlements','publisher_id','INT NULL'),
  ('miniapp_internal_publisher_settlements','publisher_revenue','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('miniapp_internal_publisher_settlements','status','VARCHAR(20) NOT NULL DEFAULT ''locked'''),
  ('miniapp_internal_publisher_settlements','stats_applied','TINYINT(1) NOT NULL DEFAULT 0'),
  ('miniapp_internal_publisher_settlements','settled_at','DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'),

  ('miniapp_external_reconciliation_runs','provider','VARCHAR(50) NULL'),
  ('miniapp_external_reconciliation_runs','status','VARCHAR(30) NOT NULL DEFAULT ''success'''),
  ('miniapp_external_reconciliation_runs','started_at','DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'),
  ('miniapp_external_reconciliation_runs','finished_at','DATETIME NULL'),
  ('miniapp_external_reconciliation_runs','duration_ms','INT UNSIGNED NOT NULL DEFAULT 0'),
  ('miniapp_external_reconciliation_runs','records_fetched','INT UNSIGNED NOT NULL DEFAULT 0'),
  ('miniapp_external_reconciliation_runs','records_updated','INT UNSIGNED NOT NULL DEFAULT 0'),
  ('miniapp_external_reconciliation_runs','records_skipped','INT UNSIGNED NOT NULL DEFAULT 0'),
  ('miniapp_external_reconciliation_runs','error_message','TEXT NULL'),
  ('miniapp_external_reconciliation_runs','metadata','JSON NULL'),

  ('miniapp_external_revenue_reconciliations','provider','VARCHAR(50) NULL'),
  ('miniapp_external_revenue_reconciliations','provider_record_id','VARCHAR(255) NULL'),
  ('miniapp_external_revenue_reconciliations','miniapp_id','BIGINT UNSIGNED NULL'),
  ('miniapp_external_revenue_reconciliations','daily_stat_id','BIGINT UNSIGNED NULL'),
  ('miniapp_external_revenue_reconciliations','network_name','VARCHAR(50) NULL'),
  ('miniapp_external_revenue_reconciliations','date','DATE NULL'),
  ('miniapp_external_revenue_reconciliations','previous_gross_revenue','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('miniapp_external_revenue_reconciliations','previous_publisher_revenue','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('miniapp_external_revenue_reconciliations','reconciled_gross_revenue','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('miniapp_external_revenue_reconciliations','reconciled_publisher_revenue','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('miniapp_external_revenue_reconciliations','gross_revenue_delta','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('miniapp_external_revenue_reconciliations','publisher_revenue_delta','DECIMAL(18,8) NOT NULL DEFAULT 0'),
  ('miniapp_external_revenue_reconciliations','impressions','BIGINT UNSIGNED NULL'),
  ('miniapp_external_revenue_reconciliations','clicks','BIGINT UNSIGNED NULL'),
  ('miniapp_external_revenue_reconciliations','completed_views','BIGINT UNSIGNED NULL'),
  ('miniapp_external_revenue_reconciliations','fill_rate','DECIMAL(10,6) NULL'),
  ('miniapp_external_revenue_reconciliations','effective_cpm','DECIMAL(18,8) NULL'),
  ('miniapp_external_revenue_reconciliations','settlement_status','VARCHAR(30) NOT NULL DEFAULT ''unsettled'''),
  ('miniapp_external_revenue_reconciliations','action','VARCHAR(30) NOT NULL DEFAULT ''applied'''),
  ('miniapp_external_revenue_reconciliations','metadata','JSON NULL'),
  ('miniapp_external_revenue_reconciliations','created_at','DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');

SET SESSION group_concat_max_len = 1048576;

-- Run one guarded ALTER per existing release table.
SET @repair_table = 'campaigns';
SELECT GROUP_CONCAT(CONCAT('ADD COLUMN `', r.column_name, '` ', r.column_definition) SEPARATOR ', ')
INTO @repair_clauses FROM schema_repair_required_columns r
LEFT JOIN INFORMATION_SCHEMA.COLUMNS c ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=r.table_name AND c.COLUMN_NAME=r.column_name
WHERE r.table_name=@repair_table AND c.COLUMN_NAME IS NULL;
SET @repair_sql=IF(@repair_clauses IS NULL,'SELECT 1',CONCAT('ALTER TABLE `',@repair_table,'` ',@repair_clauses));
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;

SET @repair_table = 'miniapp_rewarded_campaigns';
SELECT GROUP_CONCAT(CONCAT('ADD COLUMN `', r.column_name, '` ', r.column_definition) SEPARATOR ', ')
INTO @repair_clauses FROM schema_repair_required_columns r LEFT JOIN INFORMATION_SCHEMA.COLUMNS c
ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=r.table_name AND c.COLUMN_NAME=r.column_name
WHERE r.table_name=@repair_table AND c.COLUMN_NAME IS NULL;
SET @repair_sql=IF(@repair_clauses IS NULL,'SELECT 1',CONCAT('ALTER TABLE `',@repair_table,'` ',@repair_clauses));
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;

SET @repair_table = 'campaign_posts';
SELECT GROUP_CONCAT(CONCAT('ADD COLUMN `', r.column_name, '` ', r.column_definition) SEPARATOR ', ')
INTO @repair_clauses FROM schema_repair_required_columns r LEFT JOIN INFORMATION_SCHEMA.COLUMNS c
ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=r.table_name AND c.COLUMN_NAME=r.column_name
WHERE r.table_name=@repair_table AND c.COLUMN_NAME IS NULL;
SET @repair_sql=IF(@repair_clauses IS NULL,'SELECT 1',CONCAT('ALTER TABLE `',@repair_table,'` ',@repair_clauses));
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;

SET @repair_table = 'broadcast_deliveries';
SELECT GROUP_CONCAT(CONCAT('ADD COLUMN `', r.column_name, '` ', r.column_definition) SEPARATOR ', ')
INTO @repair_clauses FROM schema_repair_required_columns r LEFT JOIN INFORMATION_SCHEMA.COLUMNS c
ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=r.table_name AND c.COLUMN_NAME=r.column_name
WHERE r.table_name=@repair_table AND c.COLUMN_NAME IS NULL;
SET @repair_sql=IF(@repair_clauses IS NULL,'SELECT 1',CONCAT('ALTER TABLE `',@repair_table,'` ',@repair_clauses));
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;

SET @repair_table = 'miniapp_daily_stats';
SELECT GROUP_CONCAT(CONCAT('ADD COLUMN `', r.column_name, '` ', r.column_definition) SEPARATOR ', ')
INTO @repair_clauses FROM schema_repair_required_columns r LEFT JOIN INFORMATION_SCHEMA.COLUMNS c
ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=r.table_name AND c.COLUMN_NAME=r.column_name
WHERE r.table_name=@repair_table AND c.COLUMN_NAME IS NULL;
SET @repair_sql=IF(@repair_clauses IS NULL,'SELECT 1',CONCAT('ALTER TABLE `',@repair_table,'` ',@repair_clauses));
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;

SET @repair_table = 'miniapps';
SELECT GROUP_CONCAT(CONCAT('ADD COLUMN `', r.column_name, '` ', r.column_definition) SEPARATOR ', ')
INTO @repair_clauses FROM schema_repair_required_columns r LEFT JOIN INFORMATION_SCHEMA.COLUMNS c
ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=r.table_name AND c.COLUMN_NAME=r.column_name
WHERE r.table_name=@repair_table AND c.COLUMN_NAME IS NULL;
SET @repair_sql=IF(@repair_clauses IS NULL,'SELECT 1',CONCAT('ALTER TABLE `',@repair_table,'` ',@repair_clauses));
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;

SET @repair_table = 'channel_advertiser_debits';
SELECT GROUP_CONCAT(CONCAT('ADD COLUMN `', r.column_name, '` ', r.column_definition) SEPARATOR ', ')
INTO @repair_clauses FROM schema_repair_required_columns r LEFT JOIN INFORMATION_SCHEMA.COLUMNS c ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=r.table_name AND c.COLUMN_NAME=r.column_name WHERE r.table_name=@repair_table AND c.COLUMN_NAME IS NULL;
SET @repair_sql=IF(@repair_clauses IS NULL,'SELECT 1',CONCAT('ALTER TABLE `',@repair_table,'` ',@repair_clauses));
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;

SET @repair_table = 'miniapp_internal_publisher_settlements';
SELECT GROUP_CONCAT(CONCAT('ADD COLUMN `', r.column_name, '` ', r.column_definition) SEPARATOR ', ')
INTO @repair_clauses FROM schema_repair_required_columns r LEFT JOIN INFORMATION_SCHEMA.COLUMNS c ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=r.table_name AND c.COLUMN_NAME=r.column_name WHERE r.table_name=@repair_table AND c.COLUMN_NAME IS NULL;
SET @repair_sql=IF(@repair_clauses IS NULL,'SELECT 1',CONCAT('ALTER TABLE `',@repair_table,'` ',@repair_clauses));
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;

SET @repair_table = 'miniapp_external_reconciliation_runs';
SELECT GROUP_CONCAT(CONCAT('ADD COLUMN `', r.column_name, '` ', r.column_definition) SEPARATOR ', ')
INTO @repair_clauses FROM schema_repair_required_columns r LEFT JOIN INFORMATION_SCHEMA.COLUMNS c ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=r.table_name AND c.COLUMN_NAME=r.column_name WHERE r.table_name=@repair_table AND c.COLUMN_NAME IS NULL;
SET @repair_sql=IF(@repair_clauses IS NULL,'SELECT 1',CONCAT('ALTER TABLE `',@repair_table,'` ',@repair_clauses));
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;

SET @repair_table = 'miniapp_external_revenue_reconciliations';
SELECT GROUP_CONCAT(CONCAT('ADD COLUMN `', r.column_name, '` ', r.column_definition) SEPARATOR ', ')
INTO @repair_clauses FROM schema_repair_required_columns r LEFT JOIN INFORMATION_SCHEMA.COLUMNS c ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=r.table_name AND c.COLUMN_NAME=r.column_name WHERE r.table_name=@repair_table AND c.COLUMN_NAME IS NULL;
SET @repair_sql=IF(@repair_clauses IS NULL,'SELECT 1',CONCAT('ALTER TABLE `',@repair_table,'` ',@repair_clauses));
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;

-- Required release indexes, guarded by INFORMATION_SCHEMA.
SET @repair_sql=IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='campaign_posts' AND INDEX_NAME='idx_campaign_posts_expiry'),'SELECT 1','CREATE INDEX idx_campaign_posts_expiry ON campaign_posts(status,delivery_failed_at,deleted_at,delivery_confirmed_at,created_at)');
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;
SET @repair_sql=IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='broadcast_deliveries' AND INDEX_NAME='idx_broadcast_publisher_pending'),'SELECT 1','CREATE INDEX idx_broadcast_publisher_pending ON broadcast_deliveries(status,publisher_settled_at,created_at)');
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;
SET @repair_sql=IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='broadcast_deliveries' AND INDEX_NAME='idx_broadcast_deliveries_campaign_status_created'),'SELECT 1','CREATE INDEX idx_broadcast_deliveries_campaign_status_created ON broadcast_deliveries(campaign_id,status,created_at)');
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;
SET @repair_sql=IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='miniapp_daily_stats' AND INDEX_NAME='idx_miniapp_daily_stats_reconciliation'),'SELECT 1','CREATE INDEX idx_miniapp_daily_stats_reconciliation ON miniapp_daily_stats(reconciliation_status,reconciled_at)');
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;
SET @repair_sql=IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='miniapp_daily_stats' AND INDEX_NAME='idx_miniapp_daily_stats_provider_date'),'SELECT 1','CREATE INDEX idx_miniapp_daily_stats_provider_date ON miniapp_daily_stats(network_name,date,reconciled_at)');
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;
SET @repair_sql=IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_advertiser_debits' AND INDEX_NAME='uniq_channel_fast_debit_source'),'SELECT 1','CREATE UNIQUE INDEX uniq_channel_fast_debit_source ON channel_advertiser_debits(source_key)');
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;
SET @repair_sql=IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_advertiser_debits' AND INDEX_NAME='idx_channel_fast_debit_pending'),'SELECT 1','CREATE INDEX idx_channel_fast_debit_pending ON channel_advertiser_debits(publisher_status,created_at)');
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;
SET @repair_sql=IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_advertiser_debits' AND INDEX_NAME='idx_channel_fast_debit_campaign_date'),'SELECT 1','CREATE INDEX idx_channel_fast_debit_campaign_date ON channel_advertiser_debits(campaign_id,created_at)');
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;
SET @repair_sql=IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='miniapp_internal_publisher_settlements' AND INDEX_NAME='uniq_miniapp_internal_publisher_impression'),'SELECT 1','CREATE UNIQUE INDEX uniq_miniapp_internal_publisher_impression ON miniapp_internal_publisher_settlements(impression_id)');
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;
SET @repair_sql=IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='miniapp_internal_publisher_settlements' AND INDEX_NAME='idx_miniapp_internal_publisher_owner'),'SELECT 1','CREATE INDEX idx_miniapp_internal_publisher_owner ON miniapp_internal_publisher_settlements(publisher_id,settled_at)');
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;
SET @repair_sql=IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='miniapp_external_reconciliation_runs' AND INDEX_NAME='idx_miniapp_external_reconciliation_provider'),'SELECT 1','CREATE INDEX idx_miniapp_external_reconciliation_provider ON miniapp_external_reconciliation_runs(provider,started_at)');
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;
SET @repair_sql=IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='miniapp_external_reconciliation_runs' AND INDEX_NAME='idx_miniapp_external_reconciliation_status'),'SELECT 1','CREATE INDEX idx_miniapp_external_reconciliation_status ON miniapp_external_reconciliation_runs(status,started_at)');
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;
SET @repair_sql=IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='miniapp_external_revenue_reconciliations' AND INDEX_NAME='uniq_miniapp_external_provider_record'),'SELECT 1','CREATE UNIQUE INDEX uniq_miniapp_external_provider_record ON miniapp_external_revenue_reconciliations(provider,provider_record_id)');
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;
SET @repair_sql=IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='miniapp_external_revenue_reconciliations' AND INDEX_NAME='idx_miniapp_external_revenue_stat'),'SELECT 1','CREATE INDEX idx_miniapp_external_revenue_stat ON miniapp_external_revenue_reconciliations(daily_stat_id,created_at)');
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;
SET @repair_sql=IF(EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='miniapp_external_revenue_reconciliations' AND INDEX_NAME='idx_miniapp_external_revenue_provider_date'),'SELECT 1','CREATE INDEX idx_miniapp_external_revenue_provider_date ON miniapp_external_revenue_reconciliations(provider,date)');
PREPARE repair_stmt FROM @repair_sql; EXECUTE repair_stmt; DEALLOCATE PREPARE repair_stmt;

-- Verification output: this result set must contain zero rows after repair.
SELECT r.table_name, r.column_name, 'missing_column' AS problem
FROM schema_repair_required_columns r
LEFT JOIN INFORMATION_SCHEMA.COLUMNS c
  ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=r.table_name AND c.COLUMN_NAME=r.column_name
WHERE c.COLUMN_NAME IS NULL
UNION ALL
SELECT required.table_name, required.index_name, 'missing_index'
FROM (
  SELECT 'campaign_posts' table_name, 'idx_campaign_posts_expiry' index_name
  UNION ALL SELECT 'broadcast_deliveries','idx_broadcast_publisher_pending'
  UNION ALL SELECT 'broadcast_deliveries','idx_broadcast_deliveries_campaign_status_created'
  UNION ALL SELECT 'miniapp_daily_stats','idx_miniapp_daily_stats_reconciliation'
  UNION ALL SELECT 'miniapp_daily_stats','idx_miniapp_daily_stats_provider_date'
  UNION ALL SELECT 'channel_advertiser_debits','uniq_channel_fast_debit_source'
  UNION ALL SELECT 'channel_advertiser_debits','idx_channel_fast_debit_pending'
  UNION ALL SELECT 'channel_advertiser_debits','idx_channel_fast_debit_campaign_date'
  UNION ALL SELECT 'miniapp_internal_publisher_settlements','uniq_miniapp_internal_publisher_impression'
  UNION ALL SELECT 'miniapp_internal_publisher_settlements','idx_miniapp_internal_publisher_owner'
  UNION ALL SELECT 'miniapp_external_reconciliation_runs','idx_miniapp_external_reconciliation_provider'
  UNION ALL SELECT 'miniapp_external_reconciliation_runs','idx_miniapp_external_reconciliation_status'
  UNION ALL SELECT 'miniapp_external_revenue_reconciliations','uniq_miniapp_external_provider_record'
  UNION ALL SELECT 'miniapp_external_revenue_reconciliations','idx_miniapp_external_revenue_stat'
  UNION ALL SELECT 'miniapp_external_revenue_reconciliations','idx_miniapp_external_revenue_provider_date'
) required
LEFT JOIN INFORMATION_SCHEMA.STATISTICS s
  ON s.TABLE_SCHEMA=DATABASE() AND s.TABLE_NAME=required.table_name AND s.INDEX_NAME=required.index_name
WHERE s.INDEX_NAME IS NULL;
