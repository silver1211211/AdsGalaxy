-- Mini App earnings settlement ledger.
-- Phase 3: converts publisher_revenue from daily stats into locked/unlocked balances.

CREATE TABLE IF NOT EXISTS miniapp_earnings_settlements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  miniapp_id BIGINT UNSIGNED NOT NULL,
  user_id INT NOT NULL,
  daily_stat_id BIGINT UNSIGNED NOT NULL,
  network_name VARCHAR(50) NOT NULL,
  date DATE NOT NULL,
  impressions BIGINT UNSIGNED NOT NULL DEFAULT 0,
  publisher_revenue DECIMAL(18,8) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'locked',
  locked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unlock_at DATETIME NOT NULL,
  unlocked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_miniapp_settlement_daily_stat (daily_stat_id),
  KEY idx_miniapp_settlements_user_status_unlock (user_id, status, unlock_at),
  KEY idx_miniapp_settlements_miniapp_status (miniapp_id, status),
  CONSTRAINT fk_miniapp_settlements_miniapp
    FOREIGN KEY (miniapp_id) REFERENCES miniapps(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_miniapp_settlements_daily_stat
    FOREIGN KEY (daily_stat_id) REFERENCES miniapp_daily_stats(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
