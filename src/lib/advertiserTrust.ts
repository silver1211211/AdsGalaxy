import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

export const ADVERTISER_TRUST_LEVELS = ["new", "normal", "trusted", "premium", "restricted"] as const;
export type AdvertiserTrustLevel = typeof ADVERTISER_TRUST_LEVELS[number];

export type CampaignQualityInput = {
  name?: unknown;
  title?: unknown;
  description?: unknown;
  message_text?: unknown;
  image_url?: unknown;
  link?: unknown;
  landing_url?: unknown;
  button_text?: unknown;
  cta_text?: unknown;
  budget?: unknown;
  cpm?: unknown;
  category?: unknown;
  categories?: unknown;
  countries?: unknown;
  landing_review_flags?: unknown;
  image_review_metadata?: unknown;
};

type SettingRow = RowDataPacket & {
  key: string;
  value: string;
};

type HistoryRow = RowDataPacket & {
  total_campaigns: number;
  approved_campaigns: number;
  rejected_campaigns: number;
  total_spend: string | number;
};

const TRUST_LABELS: Record<AdvertiserTrustLevel, string> = {
  new: "New Advertiser",
  normal: "Normal Advertiser",
  trusted: "Trusted Advertiser",
  premium: "Premium Advertiser",
  restricted: "Restricted Advertiser",
};

function clean(value: unknown) {
  return String(value || "").trim();
}

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeAdvertiserTrustLevel(value: unknown): AdvertiserTrustLevel {
  const level = clean(value).toLowerCase();
  return ADVERTISER_TRUST_LEVELS.includes(level as AdvertiserTrustLevel) ? level as AdvertiserTrustLevel : "new";
}

export function advertiserTrustLabel(value: unknown) {
  return TRUST_LABELS[normalizeAdvertiserTrustLevel(value)];
}

export function qualityTier(score: number) {
  if (score <= 30) return "poor";
  if (score <= 60) return "average";
  if (score <= 80) return "good";
  return "excellent";
}

export async function getAdvertiserHistory(userId: number, conn?: PoolConnection) {
  const db = conn || pool;
  const [[history]] = await db.query<HistoryRow[]>(`
    SELECT
      (
        SELECT COUNT(*) FROM campaigns c WHERE c.user_id = ?
      ) + (
        SELECT COUNT(*) FROM miniapp_rewarded_campaigns mrc WHERE mrc.advertiser_id = ?
      ) as total_campaigns,
      (
        SELECT COUNT(*) FROM campaigns c WHERE c.user_id = ? AND c.status IN ('active', 'completed', 'budget_exhausted')
      ) + (
        SELECT COUNT(*) FROM miniapp_rewarded_campaigns mrc WHERE mrc.advertiser_id = ? AND mrc.status IN ('approved', 'completed')
      ) as approved_campaigns,
      (
        SELECT COUNT(*) FROM campaigns c WHERE c.user_id = ? AND c.status = 'rejected'
      ) + (
        SELECT COUNT(*) FROM miniapp_rewarded_campaigns mrc WHERE mrc.advertiser_id = ? AND mrc.status = 'rejected'
      ) as rejected_campaigns,
      (
        SELECT COALESCE(SUM(amount), 0) FROM advertiser_transactions atx WHERE atx.user_id = ? AND atx.type = 'debit'
      ) as total_spend
  `, [userId, userId, userId, userId, userId, userId, userId]);

  return {
    total_campaigns: Number(history?.total_campaigns || 0),
    approved_campaigns: Number(history?.approved_campaigns || 0),
    rejected_campaigns: Number(history?.rejected_campaigns || 0),
    total_spend: toNumber(history?.total_spend),
    dispute_count: 0,
  };
}

export async function calculateCampaignQualityScore(userId: number, input: CampaignQualityInput, conn?: PoolConnection) {
  const history = await getAdvertiserHistory(userId, conn);
  let score = 40;
  const metadata: Record<string, unknown> = { history };

  const name = clean(input.name || input.title);
  const body = clean(input.message_text || input.description);
  const destination = clean(input.link || input.landing_url);
  const image = clean(input.image_url);
  const button = clean(input.button_text || input.cta_text);
  const categories = Array.isArray(input.categories) ? input.categories : clean(input.category || input.categories);
  const landingFlags = Array.isArray(input.landing_review_flags) ? input.landing_review_flags : [];
  const imageMetadata = typeof input.image_review_metadata === "object" && input.image_review_metadata !== null
    ? input.image_review_metadata as Record<string, unknown>
    : {};

  if (name.length >= 5) score += 8;
  if (body.length >= 40) score += 12;
  if (body.length > 180) score += 5;
  if (/^https:\/\//i.test(destination)) score += 10;
  else if (/^http:\/\//i.test(destination)) score += 5;
  if (image) score += 8;
  if (button) score += 5;
  if ((Array.isArray(categories) && categories.length > 0) || clean(categories)) score += 5;
  if (Number(imageMetadata.width || 0) >= 512) score += 4;
  if (Number(imageMetadata.bytes || 0) > 0) score += 2;
  if (landingFlags.length > 0) score -= Math.min(15, landingFlags.length * 5);
  if (toNumber(input.budget) >= 25) score += 4;
  if (toNumber(input.cpm) >= 1) score += 4;
  if (clean(input.countries)) score += 2;

  if (history.total_campaigns >= 3) score += 5;
  if (history.approved_campaigns >= 5) score += 8;
  if (history.total_spend >= 100) score += 5;
  if (history.rejected_campaigns > 0) score -= Math.min(20, history.rejected_campaigns * 5);

  const finalScore = Math.round(clamp(score, 0, 100));
  return {
    score: finalScore,
    tier: qualityTier(finalScore),
    metadata: {
      ...metadata,
      completeness: {
        has_name: Boolean(name),
        body_length: body.length,
        has_https_destination: /^https:\/\//i.test(destination),
        has_image: Boolean(image),
        has_button: Boolean(button),
        categories: categories || [],
        landing_review_flags: landingFlags,
        image_review_metadata: imageMetadata,
      },
    },
  };
}

export async function getAdvertiserTrustMultipliers(conn?: PoolConnection) {
  const db = conn || pool;
  const [rows] = await db.query<SettingRow[]>(`
    SELECT \`key\`, value
    FROM settings
    WHERE \`key\` IN (
      'advertiser_trust_multiplier_new',
      'advertiser_trust_multiplier_normal',
      'advertiser_trust_multiplier_trusted',
      'advertiser_trust_multiplier_premium',
      'advertiser_trust_multiplier_restricted'
    )
  `);
  const map = new Map(rows.map((row) => [row.key, toNumber(row.value)]));
  return {
    new: map.get("advertiser_trust_multiplier_new") || 0.75,
    normal: map.get("advertiser_trust_multiplier_normal") || 1,
    trusted: map.get("advertiser_trust_multiplier_trusted") || 1.15,
    premium: map.get("advertiser_trust_multiplier_premium") || 1.35,
    restricted: map.get("advertiser_trust_multiplier_restricted") || 0.2,
  } satisfies Record<AdvertiserTrustLevel, number>;
}

export function qualityMultiplier(score: unknown) {
  return 0.7 + (clamp(Number(score) || 50, 0, 100) / 100) * 0.6;
}
