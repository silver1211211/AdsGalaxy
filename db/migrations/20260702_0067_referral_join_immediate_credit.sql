-- Move existing referral join rewards from pending to withdrawable balance exactly once.
SET @ddl = IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='referral_reward_ledger' AND COLUMN_NAME='settled_at')=0,
  'ALTER TABLE referral_reward_ledger ADD COLUMN settled_at DATETIME NULL', 'SELECT 1');
PREPARE referral_join_stmt FROM @ddl; EXECUTE referral_join_stmt; DEALLOCATE PREPARE referral_join_stmt;

UPDATE users u
JOIN (
  SELECT user_id,SUM(amount) amount
  FROM referral_reward_ledger
  WHERE reward_type='referral_join' AND status='pending'
  GROUP BY user_id
) pending ON pending.user_id=u.id
SET u.balance_available=u.balance_available+pending.amount,
    u.total_referral_earnings=u.total_referral_earnings+pending.amount;

UPDATE referral_reward_ledger
SET status='paid',settled_at=NOW()
WHERE reward_type='referral_join' AND status='pending';

UPDATE referrals r
SET r.reward_status=IF(r.verification_status='verified','verified_pending','join_paid'),
    r.reward_paid_at=COALESCE(r.reward_paid_at,NOW())
WHERE r.reward_status='join_pending';
