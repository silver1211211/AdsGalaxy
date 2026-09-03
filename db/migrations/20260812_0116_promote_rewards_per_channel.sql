ALTER TABLE publisher_promotion_rewards
  DROP INDEX uq_publisher_promotion_reward_referral,
  DROP INDEX uq_publisher_promotion_reward_user,
  ADD UNIQUE KEY uq_publisher_promotion_reward_channel (campaign_id, channel_id);
