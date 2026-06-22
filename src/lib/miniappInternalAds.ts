import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getMiniAppFeePercent } from "@/lib/miniappStats";
import { getMiniAppOptimizationSettings } from "@/lib/miniappOptimization";

export const INTERNAL_NETWORK_NAME = "AdsGalaxyInternal";

type CampaignRow = RowDataPacket & {
  id: number;
  campaign_name: string;
  title: string;
  description: string;
  image_url: string | null;
  landing_url: string;
  remaining_budget: string | number;
  budget: string | number;
  admin_cpm: string | number;
  target_countries: string | null;
};

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeCountryList(value: string | null) {
  return String(value || "")
    .split(",")
    .map((country) => country.trim().toUpperCase())
    .filter(Boolean);
}

export async function getInternalAdsMaxSharePercent() {
  return (await getMiniAppOptimizationSettings()).internal_ads_max_share_percent;
}

export async function canServeInternalAd(miniappId: number, conn: PoolConnection) {
  const maxSharePercent = (await getMiniAppOptimizationSettings(conn)).internal_ads_max_share_percent;
  if (maxSharePercent <= 0) return { allowed: false, reason: "internal_share_disabled", max_share_percent: maxSharePercent };

  const [[requestRow]] = await conn.query<RowDataPacket[]>(
    "SELECT COUNT(*) as total_requests FROM miniapp_mediation_requests WHERE miniapp_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)",
    [miniappId]
  );
  const [[internalRow]] = await conn.query<RowDataPacket[]>(
    "SELECT COUNT(*) as internal_impressions FROM miniapp_internal_ad_impressions WHERE miniapp_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)",
    [miniappId]
  );

  const totalRequests = Math.max(1, Number(requestRow?.total_requests || 0));
  const internalImpressions = Number(internalRow?.internal_impressions || 0);
  const currentShare = internalImpressions / totalRequests * 100;

  return {
    allowed: currentShare < maxSharePercent,
    reason: currentShare < maxSharePercent ? "eligible" : "internal_share_cap_reached",
    max_share_percent: maxSharePercent,
    current_share_percent: currentShare,
    internal_impressions: internalImpressions,
    total_requests: totalRequests,
  };
}

export async function selectInternalRewardedCampaign(input: {
  conn: PoolConnection;
  miniappId: number;
  telegramUserId?: string | number;
  country: string | null;
}) {
  const settings = await getMiniAppOptimizationSettings(input.conn);
  const cap = await canServeInternalAd(input.miniappId, input.conn);
  if (!cap.allowed) return { campaign: null, skip_reason: cap.reason };

  const [campaigns] = await input.conn.query<CampaignRow[]>(`
    SELECT id, campaign_name, title, description, image_url, landing_url, budget, remaining_budget, admin_cpm, target_countries
    FROM miniapp_rewarded_campaigns
    WHERE status = 'approved'
      AND remaining_budget > 0
      AND admin_cpm > 0
    ORDER BY created_at ASC, id ASC
    LIMIT 50
    FOR UPDATE
  `);

  const country = input.country?.toUpperCase() || null;
  let skipReason = "no_internal_campaign";
  let campaign: CampaignRow | undefined;

  for (const row of campaigns) {
    const targets = normalizeCountryList(row.target_countries);
    if (targets.length > 0 && country && !targets.includes(country)) {
      skipReason = "country_not_targeted";
      continue;
    }

    const cpm = toNumber(row.admin_cpm);
    const cost = cpm / 1000;
    if (toNumber(row.remaining_budget) < cost) {
      skipReason = "insufficient_internal_budget";
      continue;
    }

    if (input.telegramUserId) {
      const [[cooldownRow]] = await input.conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) as seen
         FROM miniapp_internal_ad_impressions
         WHERE campaign_id = ?
           AND telegram_user_id = ?
           AND created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
        [row.id, input.telegramUserId, settings.internal_campaign_user_cooldown_minutes]
      );
      if (Number(cooldownRow?.seen || 0) > 0) {
        skipReason = "internal_user_cooldown";
        continue;
      }
    }

    const [[miniappSpendRow]] = await input.conn.query<RowDataPacket[]>(
      "SELECT COALESCE(SUM(cost), 0) as spend FROM miniapp_internal_ad_impressions WHERE campaign_id = ? AND miniapp_id = ?",
      [row.id, input.miniappId]
    );
    const miniappShare = toNumber(miniappSpendRow?.spend) / Math.max(toNumber(row.budget), 0.000001) * 100;
    if (miniappShare >= settings.internal_campaign_miniapp_max_share_percent) {
      skipReason = "internal_campaign_miniapp_share_cap";
      continue;
    }

    const [[pacingRow]] = await input.conn.query<RowDataPacket[]>(`
      SELECT
        COALESCE(SUM(CASE WHEN created_at >= CURDATE() THEN cost ELSE 0 END), 0) as daily_spend,
        COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR) THEN cost ELSE 0 END), 0) as hourly_spend,
        COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE) THEN cost ELSE 0 END), 0) as rolling_spend
      FROM miniapp_internal_ad_impressions
      WHERE campaign_id = ?
    `, [row.id]);
    const budget = toNumber(row.budget);
    if (toNumber(pacingRow?.daily_spend) >= budget * 0.3) {
      skipReason = "daily_campaign_pacing";
      continue;
    }
    if (toNumber(pacingRow?.hourly_spend) >= budget * 0.1) {
      skipReason = "hourly_campaign_pacing";
      continue;
    }
    if (toNumber(pacingRow?.rolling_spend) >= budget * 0.05) {
      skipReason = "rolling_campaign_pacing";
      continue;
    }

    campaign = row;
    break;
  }

  if (!campaign) return { campaign: null, skip_reason: skipReason };

  const cpm = toNumber(campaign.admin_cpm);
  const cost = cpm / 1000;

  return {
    campaign: {
      id: Number(campaign.id),
      campaign_name: campaign.campaign_name,
      title: campaign.title,
      description: campaign.description,
      image_url: campaign.image_url,
      landing_url: campaign.landing_url,
      admin_cpm: cpm,
      estimated_cost: cost,
    },
    skip_reason: null,
  };
}

export async function recordInternalAdImpression(input: {
  conn: PoolConnection;
  campaignId: number;
  miniappId: number;
  requestId: string;
  telegramUserId: string;
  country: string | null;
}) {
  const [campaignRows] = await input.conn.query<CampaignRow[]>(
    `SELECT id, remaining_budget, admin_cpm
     FROM miniapp_rewarded_campaigns
     WHERE id = ? AND status = 'approved'
     FOR UPDATE`,
    [input.campaignId]
  );

  if (campaignRows.length === 0) {
    throw new Error("Internal campaign is not available");
  }

  const campaign = campaignRows[0];
  const cpm = toNumber(campaign.admin_cpm);
  const cost = cpm / 1000;

  if (cost <= 0 || toNumber(campaign.remaining_budget) < cost) {
    await input.conn.query(
      "UPDATE miniapp_rewarded_campaigns SET status = 'completed', remaining_budget = GREATEST(remaining_budget, 0) WHERE id = ?",
      [input.campaignId]
    );
    throw new Error("Internal campaign budget exhausted");
  }

  const [insertResult]: any = await input.conn.query(
    `INSERT IGNORE INTO miniapp_internal_ad_impressions
      (campaign_id, miniapp_id, request_id, telegram_user_id, country, cpm, cost)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.campaignId, input.miniappId, input.requestId, input.telegramUserId, input.country, cpm, cost]
  );

  if (insertResult.affectedRows !== 1) {
    return { duplicate: true, cpm, cost };
  }

  await input.conn.query(
    `UPDATE miniapp_rewarded_campaigns
     SET remaining_budget = GREATEST(remaining_budget - ?, 0),
       status = CASE WHEN GREATEST(remaining_budget - ?, 0) <= 0 THEN 'completed' ELSE status END
     WHERE id = ?`,
    [cost, cost, input.campaignId]
  );

  const feePercent = await getMiniAppFeePercent();
  const adsGalaxyFee = cost * feePercent / 100;
  const publisherRevenue = cost - adsGalaxyFee;
  const statDate = todayDate();
  const grossCpm = cpm;
  const netCpm = publisherRevenue * 1000;

  await input.conn.query(
    `INSERT INTO miniapp_daily_stats
      (miniapp_id, network_name, date, impressions, gross_revenue, ads_galaxy_fee, publisher_revenue, gross_cpm, net_cpm)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      impressions = impressions + 1,
      gross_revenue = gross_revenue + VALUES(gross_revenue),
      ads_galaxy_fee = ads_galaxy_fee + VALUES(ads_galaxy_fee),
      publisher_revenue = publisher_revenue + VALUES(publisher_revenue),
      gross_cpm = (gross_revenue / impressions) * 1000,
      net_cpm = (publisher_revenue / impressions) * 1000`,
    [input.miniappId, INTERNAL_NETWORK_NAME, statDate, cost, adsGalaxyFee, publisherRevenue, grossCpm, netCpm]
  );

  if (input.country) {
    await input.conn.query(
      `INSERT INTO miniapp_country_stats (miniapp_id, network_name, country, date, impressions)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE impressions = impressions + 1`,
      [input.miniappId, INTERNAL_NETWORK_NAME, input.country, statDate]
    );
  }

  return { duplicate: false, cpm, cost, ads_galaxy_fee: adsGalaxyFee, publisher_revenue: publisherRevenue };
}
