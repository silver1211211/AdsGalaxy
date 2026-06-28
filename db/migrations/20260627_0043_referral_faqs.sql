-- Publisher-facing referral FAQs.

INSERT INTO faqs (question, answer, type) VALUES
  ('How do I invite people with my referral link?', 'Open Publisher > Referral, copy your referral link, and share it with friends. A referral is tracked when a new user opens AdsGalaxy through your link.', 'referral'),
  ('How much do I earn per referral?', 'You earn $0.005 when your referral first joins AdsGalaxy, plus $0.010 when they join the required Telegram channel and verify successfully. The total standard reward is $0.015 per completed referral.', 'referral'),
  ('When is the first referral reward paid?', 'The $0.005 join reward is paid after a new user joins AdsGalaxy through your referral link. Duplicate, self, or suspicious referral activity may be blocked by anti-abuse checks.', 'referral'),
  ('How does the channel verification bonus work?', 'After your referred user joins the required AdsGalaxy Telegram channel and taps Verify, the system checks their membership. If verification succeeds, you receive the additional $0.010 bonus.', 'referral'),
  ('Why is a referral still pending?', 'A referral can stay pending if the user has joined AdsGalaxy but has not yet verified the required Telegram channel, or if the system is reviewing the referral for abuse signals.', 'referral'),
  ('What is the Referral Sprint?', 'Referral Sprint is a competition where verified referrals count toward leaderboards, milestone rewards, and team rewards while the sprint is active.', 'referral'),
  ('How do I join the Referral Sprint?', 'If Referral Sprint is enabled, open Publisher > Referral and share your referral link. Your eligible verified referrals are counted automatically during the active sprint.', 'referral'),
  ('What counts on the sprint leaderboard?', 'The sprint leaderboard counts referrals that complete required channel verification and pass abuse checks during the sprint. Join-only referrals earn the join reward but do not count as verified leaderboard referrals until verification is complete.', 'referral'),
  ('What are referral milestones?', 'Milestones are extra rewards unlocked when you reach configured verified-referral targets, such as 3, 10, or more verified referrals. Available milestones are shown on the Referral page.', 'referral'),
  ('How does Team League work?', 'Team League unlocks after you reach the required verified-referral count. Once unlocked, you are placed into a permanent team and your verified referrals can help your team compete for rewards.', 'referral'),
  ('Can I refer myself or create fake accounts?', 'No. Self-referrals, reciprocal referral loops, mass account creation, and other suspicious activity can be rejected by anti-abuse checks and may prevent rewards from being paid.', 'referral'),
  ('Where can I see my referral earnings and history?', 'Open Publisher > Referral to see your referral link, total earnings, pending and verified referrals, sprint rank, milestone progress, and referral history.', 'referral');
