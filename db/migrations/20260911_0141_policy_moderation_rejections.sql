-- Public Policy Center structured moderation rejection history.
-- Additive only: legacy rejection rows are intentionally not fabricated or backfilled.
CREATE TABLE IF NOT EXISTS moderation_rejections (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type VARCHAR(48) NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  policy_scope VARCHAR(64) NOT NULL,
  policy_rule_key VARCHAR(128) NOT NULL,
  public_rule_number SMALLINT UNSIGNED NOT NULL,
  policy_version VARCHAR(24) NOT NULL,
  internal_note VARCHAR(300) NULL,
  rejected_by_admin_id BIGINT UNSIGNED NOT NULL,
  rejected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_moderation_entity (entity_type, entity_id, rejected_at, id),
  KEY idx_moderation_owner (owner_user_id, rejected_at, id),
  KEY idx_moderation_scope (policy_scope, rejected_at, id),
  KEY idx_moderation_admin (rejected_by_admin_id, rejected_at, id),
  KEY idx_moderation_rejected_at (rejected_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
