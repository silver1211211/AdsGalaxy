-- Prevent unsigned counter underflow/overflow in long-running mediation health tracking.

ALTER TABLE miniapp_network_health
  MODIFY COLUMN recent_failures BIGINT UNSIGNED NOT NULL DEFAULT 0,
  MODIFY COLUMN no_fill_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  MODIFY COLUMN timeout_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  MODIFY COLUMN sdk_load_failure_count BIGINT UNSIGNED NOT NULL DEFAULT 0;
