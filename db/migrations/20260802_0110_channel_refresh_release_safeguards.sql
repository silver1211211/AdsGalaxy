SET @ddl=IF((SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='referral_reward_reversals' AND COLUMN_NAME='user_id')<>'int(11)','ALTER TABLE referral_reward_reversals MODIFY COLUMN user_id INT NOT NULL','SELECT 1');PREPARE s FROM @ddl;EXECUTE s;DEALLOCATE PREPARE s;
SET @ddl=IF((SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='referral_reward_reversals' AND COLUMN_NAME='referral_id')<>'int(11)','ALTER TABLE referral_reward_reversals MODIFY COLUMN referral_id INT NOT NULL','SELECT 1');PREPARE s FROM @ddl;EXECUTE s;DEALLOCATE PREPARE s;
ALTER TABLE referral_reward_reversals ADD KEY IF NOT EXISTS idx_referral_reward_reversal_referral (referral_id);
SET @ddl=IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='referral_reward_reversals' AND CONSTRAINT_NAME='fk_referral_reward_reversal_user')=0,'ALTER TABLE referral_reward_reversals ADD CONSTRAINT fk_referral_reward_reversal_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT','SELECT 1');PREPARE s FROM @ddl;EXECUTE s;DEALLOCATE PREPARE s;
SET @ddl=IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='referral_reward_reversals' AND CONSTRAINT_NAME='fk_referral_reward_reversal_referral')=0,'ALTER TABLE referral_reward_reversals ADD CONSTRAINT fk_referral_reward_reversal_referral FOREIGN KEY (referral_id) REFERENCES referrals(id) ON UPDATE RESTRICT ON DELETE RESTRICT','SELECT 1');PREPARE s FROM @ddl;EXECUTE s;DEALLOCATE PREPARE s;
SET @ddl=IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='referral_reward_reversals' AND CONSTRAINT_NAME='fk_referral_reward_reversal_reward')=0,'ALTER TABLE referral_reward_reversals ADD CONSTRAINT fk_referral_reward_reversal_reward FOREIGN KEY (original_reward_id) REFERENCES referral_reward_ledger(id) ON UPDATE RESTRICT ON DELETE RESTRICT','SELECT 1');PREPARE s FROM @ddl;EXECUTE s;DEALLOCATE PREPARE s;

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS subscribers_next_retry_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS below_minimum_review_required TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS below_minimum_review_required_at DATETIME NULL,
  ADD KEY IF NOT EXISTS idx_channels_subscriber_retry (subscribers_next_retry_at,id);

CREATE TABLE IF NOT EXISTS telegram_tracking_account_health (
  account_key VARCHAR(32) NOT NULL,
  status ENUM('healthy','unhealthy','unknown') NOT NULL DEFAULT 'unknown',
  last_success_at DATETIME NULL,
  last_auth_failure_at DATETIME NULL,
  last_error_code VARCHAR(64) NULL,
  manual_reauthorization_required TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY(account_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE telegram_tracking_account_health
  ADD COLUMN IF NOT EXISTS account_key VARCHAR(32) NOT NULL,
  ADD COLUMN IF NOT EXISTS status ENUM('healthy','unhealthy','unknown') NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS last_success_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS last_auth_failure_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS last_error_code VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS manual_reauthorization_required TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ADD KEY IF NOT EXISTS idx_tracking_health_status (status, updated_at);
SET @ddl=IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='telegram_tracking_account_health' AND CONSTRAINT_TYPE='PRIMARY KEY')=0,'ALTER TABLE telegram_tracking_account_health ADD PRIMARY KEY(account_key)','SELECT 1');PREPARE s FROM @ddl;EXECUTE s;DEALLOCATE PREPARE s;

CREATE TABLE IF NOT EXISTS channel_subscriber_transition_audits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  channel_id INT NOT NULL,
  publisher_user_id INT NOT NULL,
  previous_status VARCHAR(40) NOT NULL,
  new_status VARCHAR(40) NOT NULL,
  reason_code VARCHAR(64) NOT NULL,
  member_count INT NOT NULL,
  minimum_threshold INT NOT NULL,
  below_minimum_since DATETIME NULL,
  actor VARCHAR(32) NOT NULL DEFAULT 'system',
  idempotency_key VARCHAR(191) NOT NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_channel_subscriber_transition_key (idempotency_key),
  KEY idx_channel_subscriber_transition_channel (channel_id, created_at),
  CONSTRAINT fk_channel_subscriber_transition_channel FOREIGN KEY (channel_id) REFERENCES channels(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_channel_subscriber_transition_publisher FOREIGN KEY (publisher_user_id) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS referral_reconciliation_audits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_key VARCHAR(191) NOT NULL,
  user_id INT NOT NULL,
  actor VARCHAR(64) NOT NULL,
  reward_count INT NOT NULL,
  debit DECIMAL(20,8) NOT NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_referral_reconciliation_operation (operation_key),
  KEY idx_referral_reconciliation_user (user_id, created_at),
  CONSTRAINT fk_referral_reconciliation_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
