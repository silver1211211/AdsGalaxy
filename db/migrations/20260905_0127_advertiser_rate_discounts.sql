CREATE TABLE IF NOT EXISTS advertiser_rate_discounts (
  user_id INT NOT NULL,
  cpm_discount DECIMAL(18,8) NOT NULL DEFAULT 0,
  cpc_discount DECIMAL(18,8) NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  updated_by_admin_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  KEY idx_advertiser_rate_discount_expiry (expires_at),
  CONSTRAINT fk_advertiser_rate_discount_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
