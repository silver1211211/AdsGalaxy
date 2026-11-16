-- Unapplied foundation for canonical server click observations. No historical backfill.
-- The app's ordinary DB account can alter this table: it is auditable, not independently tamper-proof.
-- A separate privileged retention/access policy and external evidence attestation are needed before bonuses.
CREATE TABLE IF NOT EXISTS channel_click_evidence (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 source_click_id BIGINT UNSIGNED NOT NULL,
 idempotency_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 source_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 campaign_id BIGINT UNSIGNED NOT NULL,
 publisher_id BIGINT UNSIGNED NOT NULL,
 channel_id BIGINT UNSIGNED NOT NULL,
 post_id BIGINT UNSIGNED NOT NULL,
 window_id BIGINT UNSIGNED NULL,
 event_epoch BIGINT UNSIGNED NOT NULL,
 ingested_at DATETIME(6) NOT NULL,
 source_type VARCHAR(32) NOT NULL,
 validation_version VARCHAR(64) NOT NULL,
 provenance VARCHAR(32) NOT NULL,
 outcome VARCHAR(32) NOT NULL,
 reason VARCHAR(64) NOT NULL,
 dedup_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
 UNIQUE KEY uq_channel_click_source (source_click_id),
 UNIQUE KEY uq_channel_click_idempotency (idempotency_hash),
 KEY idx_channel_click_window (campaign_id,window_id,publisher_id,event_epoch,id),
 KEY idx_channel_click_dedup (campaign_id,post_id,dedup_hash,event_epoch),
 KEY idx_channel_click_ingested (ingested_at),
 CONSTRAINT chk_channel_click_outcome CHECK (outcome IN ('observed_unverified','rejected','validated')),
 CONSTRAINT fk_channel_click_window FOREIGN KEY (window_id) REFERENCES channel_cpm_settlement_windows(id)
) ENGINE=InnoDB;
CREATE TRIGGER IF NOT EXISTS trg_channel_click_evidence_no_update BEFORE UPDATE ON channel_click_evidence FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='click_evidence_immutable';
CREATE TRIGGER IF NOT EXISTS trg_channel_click_evidence_no_delete BEFORE DELETE ON channel_click_evidence FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='click_evidence_immutable';
