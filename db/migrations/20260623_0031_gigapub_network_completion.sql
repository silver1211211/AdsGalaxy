-- Phase 13E: GigaPub adapter completion and Mini App network ordering.
-- Additive only. Does not modify CPM, payout, withdrawal, referral, channel, bot, or system log logic.

UPDATE miniapp_ad_networks
SET priority_order = CASE network_name
  WHEN 'AdsGram' THEN 1
  WHEN 'Monetag' THEN 2
  WHEN 'RichAds' THEN 3
  WHEN 'AdExium' THEN 4
  WHEN 'GigaPub' THEN 5
  WHEN 'AdsGalaxyInternal' THEN 6
  ELSE priority_order
END
WHERE network_name IN ('AdsGram', 'Monetag', 'RichAds', 'AdExium', 'GigaPub', 'AdsGalaxyInternal')
  AND (priority_order IS NULL OR priority_order = 0 OR priority_order > 99);

INSERT IGNORE INTO miniapp_network_health (miniapp_id, network_name, health_score, recent_failures)
SELECT id, 'GigaPub', 100, 0
FROM miniapps
WHERE is_deleted = FALSE;
