-- Admin-controlled in-app self promotion / announcement ads.

CREATE TABLE IF NOT EXISTS self_promotion_ads (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  cta_text VARCHAR(80) NOT NULL,
  cta_url VARCHAR(512) NOT NULL,
  image_data_url MEDIUMTEXT NULL,
  image_mime_type VARCHAR(64) NULL,
  countdown_seconds INT NOT NULL DEFAULT 5,
  frequency_hours INT NOT NULL DEFAULT 24,
  start_at DATETIME NULL,
  end_at DATETIME NULL,
  max_impressions_per_user INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_self_promotion_active (enabled, status, start_at, end_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS self_promotion_ad_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ad_id BIGINT UNSIGNED NOT NULL,
  user_id INT NOT NULL,
  event_type ENUM('impression', 'click', 'dismissal') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSON NULL,
  PRIMARY KEY (id),
  KEY idx_self_promo_events_user_ad_type_time (user_id, ad_id, event_type, created_at),
  KEY idx_self_promo_events_ad_type_time (ad_id, event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO self_promotion_ads
  (id, enabled, status, title, description, cta_text, cta_url, countdown_seconds, frequency_hours, max_impressions_per_user)
VALUES
  (1, 1, 'active', 'Host Your Telegram Bot For Free', 'Create, host, and manage your Telegram bots easily with BothostPro.', 'Host Free Bot', 'https://bothostpro.com', 5, 24, NULL)
ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  description = VALUES(description),
  cta_text = VALUES(cta_text),
  cta_url = VALUES(cta_url),
  countdown_seconds = VALUES(countdown_seconds),
  frequency_hours = VALUES(frequency_hours);
