export class CampaignSchemaNotReadyError extends Error {
  readonly code: string;
  readonly missing: string[];

  constructor(missing: string[]) {
    super("Campaign creation schema is not ready");
    this.name = "CampaignSchemaNotReadyError";
    this.code = "CAMPAIGN_SCHEMA_NOT_READY";
    this.missing = missing;
  }
}

const CAMPAIGN_CREATION_SCHEMA = {
  users: ["id", "ad_balance", "advertiser_trust_level", "telegram_id"],
  campaigns: [
    "id", "user_id", "name", "campaign_title", "parse_mode", "message_text",
    "image_url", "link", "button_text", "type", "campaign_kind", "billing_model", "funding_model",
    "cost_per_subscriber", "destination_chat_id", "growth_tracking_status",
    "budget",
    "total_budget", "cpm", "cpc", "category", "quality_score", "quality_tier",
    "quality_metadata", "continents", "countries", "languages", "vpn_policy",
    "device_policy", "os_policy", "start_at", "end_at", "daily_budget_limit",
    "frequency_cap_per_user", "direct_placement_mode", "direct_inventory_scope",
    "direct_inventory_metadata", "teaser_mode", "teaser_enabled", "teaser_cta_key",
    "teaser_cpm", "status",
  ],
  advertiser_transactions: ["user_id", "amount", "type", "description"],
  advertiser_direct_debits: ["source_key", "advertiser_id", "campaign_id", "campaign_table", "billing_type", "amount", "status"],
  campaign_direct_inventory_targets: ["campaign_type", "campaign_id", "inventory_type", "inventory_id"],
  campaign_inventory_exclusions: ["campaign_type", "campaign_id", "inventory_type", "normalized_identifier"],
  settings: ["key", "value"],
  inventory_marketplace_analytics: ["advertiser_id", "inventory_type", "inventory_id", "event_type", "metadata"],
  campaign_review_queue: ["campaign_type", "campaign_id", "advertiser_id", "risk_level", "reason", "rule_used", "metadata"],
  domain_review_queue: ["domain", "risk_level", "reason", "metadata"],
  domain_trust_rules: ["domain", "status", "campaign_count"],
  automation_audit_logs: ["actor_type", "actor_id", "action", "entity_type", "entity_id", "decision", "rule_used", "reason", "metadata"],
} as const;

type ReadinessDb = {
  query(sql: string, values?: unknown[]): Promise<[unknown[], ...unknown[]]>;
};

export async function assertCampaignCreationSchemaReady(db: ReadinessDb) {
  const expected = Object.entries(CAMPAIGN_CREATION_SCHEMA);
  const [result] = await db.query(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (?)`,
    [expected.map(([table]) => table)]
  );
  const rows = result as Array<{ table_name: string; column_name: string }>;
  const available = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = expected.flatMap(([table, columns]) =>
    columns
      .filter((column) => !available.has(`${table}.${column}`))
      .map((column) => `${table}.${column}`)
  );
  if (missing.length > 0) throw new CampaignSchemaNotReadyError(missing);
}
