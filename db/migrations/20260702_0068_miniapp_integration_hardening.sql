-- Mini App integration hardening. Additive constraints and reporting indexes only.

DELETE newer FROM miniapp_internal_ad_completion_events newer
JOIN miniapp_internal_ad_completion_events original
  ON original.request_id = newer.request_id
 AND original.event_type = newer.event_type
 AND original.id < newer.id;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_miniapp_completion_request_event
  ON miniapp_internal_ad_completion_events (request_id, event_type);

DELETE newer FROM developer_sandbox_events newer
JOIN developer_sandbox_events original
  ON original.application_id = newer.application_id
 AND original.request_id = newer.request_id
 AND original.event_type = newer.event_type
 AND original.id < newer.id
WHERE newer.request_id IS NOT NULL AND newer.request_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_developer_sandbox_request_event
  ON developer_sandbox_events (application_id, request_id, event_type);

CREATE INDEX IF NOT EXISTS idx_miniapp_daily_stats_app_date
  ON miniapp_daily_stats (miniapp_id, date);

CREATE INDEX IF NOT EXISTS idx_miniapp_country_stats_app_date
  ON miniapp_country_stats (miniapp_id, date);

CREATE INDEX IF NOT EXISTS idx_miniapp_mediation_root_result
  ON miniapp_mediation_requests (miniapp_id, root_request_id, final_result, created_at);
