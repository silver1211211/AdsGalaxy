ALTER TABLE miniapp_ad_networks
  ADD COLUMN IF NOT EXISTS richads_publisher_id VARCHAR(255) NULL AFTER network_placement_id,
  ADD COLUMN IF NOT EXISTS richads_app_id VARCHAR(255) NULL AFTER richads_publisher_id;

UPDATE miniapp_ad_networks
SET richads_app_id = COALESCE(richads_app_id, network_placement_id)
WHERE network_name = 'RichAds' AND network_placement_id IS NOT NULL;

UPDATE miniapp_ad_networks
SET enabled = FALSE
WHERE network_name = 'RichAds'
  AND (NULLIF(TRIM(richads_publisher_id), '') IS NULL OR NULLIF(TRIM(richads_app_id), '') IS NULL);
