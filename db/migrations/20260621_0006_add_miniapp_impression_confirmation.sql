-- Mini App mediation impression confirmation state.
-- A mediation request can be confirmed once; duplicates must not increment stats.

ALTER TABLE miniapp_mediation_requests
  ADD COLUMN IF NOT EXISTS impression_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS impression_confirmed_at DATETIME NULL;

CREATE INDEX IF NOT EXISTS idx_miniapp_mediation_requests_confirmed
  ON miniapp_mediation_requests (impression_confirmed, impression_confirmed_at);
