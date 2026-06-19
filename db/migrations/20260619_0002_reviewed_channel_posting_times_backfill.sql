-- AdsGalaxy / AdsFusion reviewed backfill for channel posting_times.
--
-- Run only after reviewing current production channel distribution.
-- This intentionally avoids defaulting every channel to the same time.
--
-- Recommended mapping:
-- posts_per_day <= 1 -> ["12:00"]
-- posts_per_day = 2  -> ["12:00","18:00"]
-- posts_per_day >= 3 -> ["12:00","18:00","00:00"]
--
-- The WHERE clause preserves any channels that already have posting_times.

UPDATE channels
SET posting_times = CASE
  WHEN COALESCE(posts_per_day, 1) <= 1 THEN JSON_ARRAY('12:00')
  WHEN posts_per_day = 2 THEN JSON_ARRAY('12:00', '18:00')
  ELSE JSON_ARRAY('12:00', '18:00', '00:00')
END
WHERE posting_times IS NULL;
