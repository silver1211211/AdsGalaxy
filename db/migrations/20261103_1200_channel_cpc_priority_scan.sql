-- Prepared for isolated validation only. Do not apply to production in Chunk 4C-1.
CREATE TABLE IF NOT EXISTS channel_cpc_priority_scan_state (
  campaign_id BIGINT NOT NULL PRIMARY KEY,
  round_id BIGINT NOT NULL DEFAULT 1,
  highwater_post_id BIGINT NOT NULL DEFAULT 0,
  cursor_post_id BIGINT NOT NULL DEFAULT 0,
  as_of_epoch BIGINT NOT NULL,
  scan_started_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  phase ENUM('scanning','paying') NOT NULL DEFAULT 'scanning',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS channel_cpc_priority_scan_publishers (
  campaign_id BIGINT NOT NULL,
  publisher_id BIGINT NOT NULL,
  round_id BIGINT NOT NULL,
  verified_views BIGINT NOT NULL DEFAULT 0,
  unpaid_views BIGINT NOT NULL DEFAULT 0,
  first_epoch BIGINT NOT NULL,
  last_reward_epoch BIGINT NULL,
  previous_paid DECIMAL(20,8) NOT NULL DEFAULT 0,
  has_clicks TINYINT NOT NULL DEFAULT 0,
  validated TINYINT NOT NULL DEFAULT 1,
  score INT NOT NULL DEFAULT 0,
  state ENUM('pending','ready','excluded','done') NOT NULL DEFAULT 'pending',
  post_cursor_id BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id,publisher_id),
  KEY idx_cpc_priority_rank (campaign_id,round_id,state,score DESC,unpaid_views DESC,publisher_id)
) ENGINE=InnoDB;
