-- Mini App Monetization launch access flag.
-- Mini Apps are live for all accounts; the legacy flag remains for older admin/UI compatibility.

ALTER TABLE users
  ADD COLUMN miniapp_beta_access TINYINT(1) NOT NULL DEFAULT 1;

UPDATE users
SET miniapp_beta_access = 1
WHERE miniapp_beta_access <> 1;
