-- Phase 16: Referral Sprint feature toggle, team league controls, and growth notifications.
-- Additive only. Does not modify CPM, payout, Mini App SDK, network mediation,
-- channel scheduler, bot broadcast architecture, or system logs.

CREATE TABLE IF NOT EXISTS referral_growth_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  notification_type VARCHAR(60) NOT NULL,
  title VARCHAR(160) NOT NULL,
  message VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'unread',
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_referral_growth_notifications_user (user_id, status, created_at),
  KEY idx_referral_growth_notifications_type (notification_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO referral_growth_settings (`key`, value, description) VALUES
  ('referral_sprint_enabled', '1', 'Enable Referral Sprint, Team League, Team Rewards, and growth UI'),
  ('referral_dashboard_promotion_enabled', '1', 'Show referral sprint promotion card on publisher dashboard'),
  ('referral_sprint_ending_warning_days', '3', 'Notify users when the sprint ends within this many days'),
  ('referral_team_rewards_enabled', '1', 'Enable team league rewards during sprint finalization')
ON DUPLICATE KEY UPDATE value = value;
