import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

export type ExclusionCampaignType = "campaign" | "miniapp";
export type ExclusionInventoryType = "channel" | "bot" | "miniapp";
type Db = typeof pool | PoolConnection;

const MAX_EXCLUSIONS = 100;

export function normalizeTelegramInventoryIdentifier(value: unknown): string | null {
  let text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  text = text.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const link = text.match(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/([^/]+)(?:\/.*)?$/i);
  if (link) text = link[1];
  text = text.replace(/^@+/, "");
  return /^[a-z0-9_]{5,32}$/.test(text) ? text : null;
}

export function parseCampaignExclusions(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[\n,]+/);
  const output = new Set<string>();
  for (const entry of raw) {
    const normalized = normalizeTelegramInventoryIdentifier(entry);
    if (!normalized) continue;
    output.add(normalized);
    if (output.size >= MAX_EXCLUSIONS) break;
  }
  return [...output];
}

export async function replaceCampaignExclusions(db: Db, input: {
  campaignType: ExclusionCampaignType;
  campaignId: number;
  inventoryType: ExclusionInventoryType;
  identifiers: unknown;
}) {
  const identifiers = parseCampaignExclusions(input.identifiers);
  await db.query(
    "DELETE FROM campaign_inventory_exclusions WHERE campaign_type = ? AND campaign_id = ? AND inventory_type = ?",
    [input.campaignType, input.campaignId, input.inventoryType]
  );
  for (const identifier of identifiers) {
    await db.query(
      `INSERT INTO campaign_inventory_exclusions
        (campaign_type, campaign_id, inventory_type, normalized_identifier)
       VALUES (?, ?, ?, ?)`,
      [input.campaignType, input.campaignId, input.inventoryType, identifier]
    );
  }
  return identifiers;
}

export async function loadCampaignExclusions(db: Db, campaignType: ExclusionCampaignType, campaignIds: number[], inventoryType: ExclusionInventoryType) {
  if (!campaignIds.length) return new Map<number, Set<string>>();
  const [rows] = await db.query<Array<RowDataPacket & { campaign_id: number; normalized_identifier: string }>>(
    `SELECT campaign_id, normalized_identifier FROM campaign_inventory_exclusions
     WHERE campaign_type = ? AND inventory_type = ? AND campaign_id IN (?)`,
    [campaignType, inventoryType, campaignIds]
  );
  const map = new Map<number, Set<string>>();
  for (const row of rows) {
    const values = map.get(Number(row.campaign_id)) || new Set<string>();
    values.add(row.normalized_identifier);
    map.set(Number(row.campaign_id), values);
  }
  return map;
}

export function campaignExcludesIdentifier(exclusions: Map<number, Set<string>>, campaignId: number, identifier: unknown) {
  const normalized = normalizeTelegramInventoryIdentifier(identifier);
  return !!normalized && exclusions.get(Number(campaignId))?.has(normalized) === true;
}
