-- New-policy Standard CPC view claims; no advertiser charge or reserve movement.
CREATE TABLE channel_standard_cpc_view_entitlements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  campaign_id INT NOT NULL,
  publisher_id INT NOT NULL,
  post_id INT NOT NULL,
  channel_id INT NOT NULL,
  observed_views BIGINT UNSIGNED NOT NULL,
  entitled_amount DECIMAL(24,8) NOT NULL DEFAULT 0,
  funded_amount DECIMAL(24,8) NOT NULL DEFAULT 0,
  pending_amount DECIMAL(24,8) NOT NULL DEFAULT 0,
  hold_reason VARCHAR(80) NULL,
  last_funded_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_standard_cpc_view_post (post_id),
  KEY ix_standard_cpc_view_queue (campaign_id,pending_amount,last_funded_at,created_at,id),
  KEY ix_standard_cpc_view_publisher (campaign_id,publisher_id,id),
  CONSTRAINT fk_standard_cpc_view_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT,
  CONSTRAINT fk_standard_cpc_view_publisher FOREIGN KEY (publisher_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_standard_cpc_view_amounts CHECK (
    entitled_amount>=0 AND entitled_amount<=0.10000000 AND funded_amount>=0
    AND funded_amount<=entitled_amount AND pending_amount=entitled_amount-funded_amount
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
