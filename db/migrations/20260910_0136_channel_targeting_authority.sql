-- Shared, additive authority fields for Channel inventory targeting. No backfill runs here.
ALTER TABLE channel_geo_classifications
  ADD COLUMN authoritative_country_code CHAR(2) NULL AFTER authoritative_region,
  ADD COLUMN country_confidence DECIMAL(5,4) NULL AFTER confidence,
  ADD COLUMN country_source VARCHAR(64) NULL AFTER source,
  ADD COLUMN country_classified_at DATETIME NULL AFTER classified_at,
  ADD COLUMN authoritative_language_code VARCHAR(8) NULL AFTER authoritative_country_code,
  ADD COLUMN language_confidence DECIMAL(5,4) NULL AFTER country_confidence,
  ADD COLUMN language_source VARCHAR(64) NULL AFTER country_source,
  ADD COLUMN language_classified_at DATETIME NULL AFTER country_classified_at,
  ADD COLUMN targeting_override_by INT NULL AFTER classified_by,
  ADD COLUMN targeting_override_at DATETIME NULL AFTER updated_at,
  ADD KEY idx_channel_targeting_country (authoritative_country_code),
  ADD KEY idx_channel_targeting_language (authoritative_language_code);
