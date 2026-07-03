-- Verification fixes for channel monetization accounting.
UPDATE users SET balance_locked = 0 WHERE balance_locked IS NULL;
UPDATE users SET balance_available = 0 WHERE balance_available IS NULL;
ALTER TABLE users
  MODIFY COLUMN balance_locked DECIMAL(18,8) NOT NULL DEFAULT 0,
  MODIFY COLUMN balance_available DECIMAL(18,8) NOT NULL DEFAULT 0;

-- Publisher payout is now controlled by platform margin, reserve, and PQI.
DELETE FROM settings
WHERE `key` IN ('view_ad_reward_percentage', 'click_ad_reward_percentage');
