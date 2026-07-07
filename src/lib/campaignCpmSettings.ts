import "server-only";

import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

type Db = typeof pool | PoolConnection;
type CampaignCpmType = "views" | "clicks" | "broadcast";
type SettingRow = RowDataPacket & { key: string; value: string };

const DEFAULTS: Record<CampaignCpmType, { min: number; recommended: number; max: number }> = {
  views: { min: 0.5, recommended: 1.5, max: 5 },
  clicks: { min: 2, recommended: 5, max: 20 },
  broadcast: { min: 1, recommended: 3, max: 10 },
};

const KEYS = [
  "min_cpm_views",
  "recommended_cpm_views",
  "max_cpm_views",
  "min_cpm_clicks",
  "recommended_cpm_clicks",
  "max_cpm_clicks",
  "min_cpm_broadcast",
  "recommended_cpm_broadcast",
  "max_cpm_broadcast",
] as const;

function money(value: unknown, fallback: number) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeCampaignCpmType(value: unknown): CampaignCpmType {
  const type = String(value || "").toLowerCase();
  if (type === "clicks") return "clicks";
  if (type === "broadcast") return "broadcast";
  return "views";
}

export async function getCampaignCpmSettings(type: CampaignCpmType, conn?: PoolConnection) {
  const db: Db = conn || pool;
  const [rows] = await db.query<SettingRow[]>(
    "SELECT `key`, value FROM settings WHERE `key` IN (?)",
    [KEYS]
  );
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const defaults = DEFAULTS[type];
  const min = Math.max(0, money(map.get(`min_cpm_${type}`), defaults.min));
  const max = Math.max(0, money(map.get(`max_cpm_${type}`), defaults.max));
  const normalizedMax = max > 0 ? Math.max(min, max) : max;
  const recommended = money(map.get(`recommended_cpm_${type}`), defaults.recommended);
  return {
    type,
    min_cpm: min,
    recommended_cpm: Math.max(min, normalizedMax > 0 ? Math.min(normalizedMax, recommended) : recommended),
    max_cpm: normalizedMax,
  };
}

export async function validateCampaignCpmBid(typeInput: unknown, cpmInput: unknown, conn?: PoolConnection) {
  const type = normalizeCampaignCpmType(typeInput);
  const cpm = Number(cpmInput);
  if (!Number.isFinite(cpm) || cpm <= 0) {
    throw new Error("CPM Bid is required");
  }
  const settings = await getCampaignCpmSettings(type, conn);
  if (settings.min_cpm > 0 && cpm < settings.min_cpm) {
    throw new Error(`CPM Bid must be at least $${settings.min_cpm.toFixed(2)} for ${type} campaigns`);
  }
  if (settings.max_cpm > 0 && cpm > settings.max_cpm) {
    throw new Error(`CPM Bid cannot exceed $${settings.max_cpm.toFixed(2)} for ${type} campaigns`);
  }
  return { type, cpm, settings };
}
