-- Two-calendar-month advertiser deposit bonus.
-- The singleton activation window is immutable: reruns never reset starts_at or ends_at.

CREATE TABLE IF NOT EXISTS deposit_promotions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(100) NOT NULL,
  name VARCHAR(160) NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_deposit_promotions_slug (slug),
  KEY idx_deposit_promotions_window (is_active, starts_at, ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO deposit_promotions
  (slug, name, starts_at, ends_at, is_active, metadata, created_at)
VALUES
  ('deposit-bonus-2026-two-month', 'Two-month deposit bonus', UTC_TIMESTAMP(),
   DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 MONTH), 1,
   JSON_OBJECT('max_rate_percent', 12, 'destination', 'ad_balance', 'withdrawable', FALSE),
   UTC_TIMESTAMP());

SET @deposit_confirmed_at_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='deposits' AND COLUMN_NAME='confirmed_at'),
  'SELECT 1',
  'ALTER TABLE deposits ADD COLUMN confirmed_at DATETIME NULL AFTER status'
);
PREPARE deposit_confirmed_at_stmt FROM @deposit_confirmed_at_sql;
EXECUTE deposit_confirmed_at_stmt;
DEALLOCATE PREPARE deposit_confirmed_at_stmt;

SET @deposit_reversed_at_sql = IF(
  EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='deposits' AND COLUMN_NAME='reversed_at'),
  'SELECT 1',
  'ALTER TABLE deposits ADD COLUMN reversed_at DATETIME NULL AFTER confirmed_at'
);
PREPARE deposit_reversed_at_stmt FROM @deposit_reversed_at_sql;
EXECUTE deposit_reversed_at_stmt;
DEALLOCATE PREPARE deposit_reversed_at_stmt;

CREATE TABLE IF NOT EXISTS deposit_bonuses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  deposit_id BIGINT NOT NULL,
  user_id INT NOT NULL,
  promotion_id BIGINT UNSIGNED NOT NULL,
  confirmed_amount DECIMAL(18,8) NOT NULL,
  rate_basis_points SMALLINT UNSIGNED NOT NULL,
  bonus_amount DECIMAL(18,8) NOT NULL,
  resulting_ad_balance DECIMAL(18,8) NOT NULL,
  reversed_amount DECIMAL(18,8) NOT NULL DEFAULT 0,
  status ENUM('awarded','reversed') NOT NULL DEFAULT 'awarded',
  awarded_at DATETIME NOT NULL,
  reversed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_deposit_bonus_deposit (deposit_id),
  KEY idx_deposit_bonus_user (user_id, created_at),
  KEY idx_deposit_bonus_promotion (promotion_id),
  CONSTRAINT fk_deposit_bonus_promotion FOREIGN KEY (promotion_id) REFERENCES deposit_promotions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
