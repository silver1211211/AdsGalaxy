-- Remediation Pass 2: support the single-pass referral team leaderboard aggregates.
-- Intentionally not applied by Codex on production.
ALTER TABLE referral_team_memberships
  ADD INDEX IF NOT EXISTS idx_referral_team_members_team_user (team_id, user_id);

ALTER TABLE referrals
  ADD INDEX IF NOT EXISTS idx_referrals_inviter_verified_sprint (invited_by, verification_status, sprint_id);
