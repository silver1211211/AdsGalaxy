-- Immutable prepared plans. No credit, debit, or production settlement is performed here.
CREATE TABLE IF NOT EXISTS channel_cpm_allocation_plans (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 window_id BIGINT UNSIGNED NOT NULL, campaign_id BIGINT UNSIGNED NOT NULL,
 plan_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 manifest_json LONGTEXT NOT NULL, publisher_pool DECIMAL(20,8) NOT NULL,
 policy_version VARCHAR(96) NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'prepared',
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_cpm_plan_window(window_id), UNIQUE KEY uq_cpm_plan_hash(plan_hash),
 CONSTRAINT fk_cpm_plan_window FOREIGN KEY(window_id) REFERENCES channel_cpm_settlement_windows(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS channel_cpm_plan_publishers (
 plan_id BIGINT UNSIGNED NOT NULL, publisher_id BIGINT UNSIGNED NOT NULL,
 neutral_amount DECIMAL(20,8) NOT NULL, adjustment_amount DECIMAL(20,8) NOT NULL,
 final_amount DECIMAL(20,8) NOT NULL, valid_views BIGINT UNSIGNED NOT NULL,
 verified_clicks BIGINT UNSIGNED NOT NULL, quality_bps INT UNSIGNED NOT NULL,
 engagement_trusted TINYINT NOT NULL, click_evidence VARCHAR(48) NOT NULL,
 PRIMARY KEY(plan_id,publisher_id), CONSTRAINT fk_cpm_plan_pub FOREIGN KEY(plan_id) REFERENCES channel_cpm_allocation_plans(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS channel_cpm_plan_sources (
 plan_id BIGINT UNSIGNED NOT NULL, pending_allocation_id BIGINT UNSIGNED NOT NULL,
 canonical_event_id BIGINT UNSIGNED NOT NULL, source_key VARCHAR(191) NOT NULL,
 PRIMARY KEY(plan_id,pending_allocation_id), UNIQUE KEY uq_cpm_plan_allocation(pending_allocation_id),
 UNIQUE KEY uq_cpm_plan_event(canonical_event_id), UNIQUE KEY uq_cpm_plan_source(source_key),
 CONSTRAINT fk_cpm_plan_source_header FOREIGN KEY(plan_id) REFERENCES channel_cpm_allocation_plans(id),
 CONSTRAINT fk_cpm_plan_source_allocation FOREIGN KEY(pending_allocation_id) REFERENCES channel_cpm_pending_allocations(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS channel_cpm_plan_seals (plan_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, plan_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), CONSTRAINT fk_cpm_plan_seal FOREIGN KEY(plan_id) REFERENCES channel_cpm_allocation_plans(id)) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS channel_cpm_plan_insert_guard (id TINYINT NOT NULL PRIMARY KEY) ENGINE=InnoDB;
INSERT IGNORE INTO channel_cpm_plan_insert_guard (id) VALUES (1);
CREATE TRIGGER IF NOT EXISTS trg_cpm_plan_guard_no_update BEFORE UPDATE ON channel_cpm_plan_insert_guard FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='cpm_plan_immutable';
CREATE TRIGGER IF NOT EXISTS trg_cpm_plan_guard_no_delete BEFORE DELETE ON channel_cpm_plan_insert_guard FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='cpm_plan_immutable';
CREATE TRIGGER IF NOT EXISTS trg_cpm_plan_pub_no_late_insert BEFORE INSERT ON channel_cpm_plan_publishers FOR EACH ROW INSERT INTO channel_cpm_plan_insert_guard (id) SELECT 1 FROM channel_cpm_plan_seals WHERE plan_id=NEW.plan_id;
CREATE TRIGGER IF NOT EXISTS trg_cpm_plan_src_no_late_insert BEFORE INSERT ON channel_cpm_plan_sources FOR EACH ROW INSERT INTO channel_cpm_plan_insert_guard (id) SELECT 1 FROM channel_cpm_plan_seals WHERE plan_id=NEW.plan_id;
CREATE TRIGGER IF NOT EXISTS trg_cpm_plan_seal_no_update BEFORE UPDATE ON channel_cpm_plan_seals FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='cpm_plan_immutable';
CREATE TRIGGER IF NOT EXISTS trg_cpm_plan_seal_no_delete BEFORE DELETE ON channel_cpm_plan_seals FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='cpm_plan_immutable';
CREATE TABLE IF NOT EXISTS channel_cpm_plan_late_events (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,window_id BIGINT UNSIGNED NOT NULL,source_key VARCHAR(191) NOT NULL,canonical_event_id BIGINT UNSIGNED NULL,reason VARCHAR(64) NOT NULL,observed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),UNIQUE KEY uq_cpm_late_source(window_id,source_key),CONSTRAINT fk_cpm_late_window FOREIGN KEY(window_id) REFERENCES channel_cpm_settlement_windows(id)) ENGINE=InnoDB;
CREATE TRIGGER IF NOT EXISTS trg_cpm_plan_late_no_update BEFORE UPDATE ON channel_cpm_plan_late_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='cpm_late_event_immutable';
CREATE TRIGGER IF NOT EXISTS trg_cpm_plan_late_no_delete BEFORE DELETE ON channel_cpm_plan_late_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='cpm_late_event_immutable';
CREATE TRIGGER IF NOT EXISTS trg_cpm_plan_no_update BEFORE UPDATE ON channel_cpm_allocation_plans FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='cpm_plan_immutable';
CREATE TRIGGER IF NOT EXISTS trg_cpm_plan_no_delete BEFORE DELETE ON channel_cpm_allocation_plans FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='cpm_plan_immutable';
CREATE TRIGGER IF NOT EXISTS trg_cpm_plan_pub_no_update BEFORE UPDATE ON channel_cpm_plan_publishers FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='cpm_plan_immutable';
CREATE TRIGGER IF NOT EXISTS trg_cpm_plan_pub_no_delete BEFORE DELETE ON channel_cpm_plan_publishers FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='cpm_plan_immutable';
CREATE TRIGGER IF NOT EXISTS trg_cpm_plan_source_no_update BEFORE UPDATE ON channel_cpm_plan_sources FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='cpm_plan_immutable';
CREATE TRIGGER IF NOT EXISTS trg_cpm_plan_source_no_delete BEFORE DELETE ON channel_cpm_plan_sources FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='cpm_plan_immutable';
