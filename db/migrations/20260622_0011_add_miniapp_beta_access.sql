-- Temporary Mini App Monetization beta access flag.
-- Launch day removal: set this flag to 1 for all publishers or remove checks in src/lib/miniappBetaAccess.ts.

ALTER TABLE users
  ADD COLUMN miniapp_beta_access TINYINT(1) NOT NULL DEFAULT 0;
