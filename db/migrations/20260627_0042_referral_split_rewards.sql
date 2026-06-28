-- Split referral rewards into an instant join reward and a channel verification bonus.
-- The total stays $0.015, but users see and receive $0.005 when a referral joins
-- and $0.010 after that referral joins/verifies the required Telegram channel.

INSERT INTO referral_growth_settings (`key`, value, description) VALUES
  ('referral_join_reward_amount', '0.005', 'Reward paid to the referrer when a referred user first joins AdsGalaxy'),
  ('referral_verification_reward_amount', '0.010', 'Additional reward paid after the referred user verifies required channel membership'),
  ('referral_sprint_popup_interval_seconds', '86400', 'Minimum seconds before the Referral Sprint popup is shown again after dismissal'),
  ('referral_sprint_popup_interval_hours', '24', 'Minimum hours before the Referral Sprint popup is shown again after dismissal')
ON DUPLICATE KEY UPDATE
  value = VALUES(value),
  description = VALUES(description);

UPDATE referral_growth_settings
SET value = '0.015',
    description = 'Total displayed referral reward: join reward plus channel verification bonus'
WHERE `key` = 'referral_reward_amount';
