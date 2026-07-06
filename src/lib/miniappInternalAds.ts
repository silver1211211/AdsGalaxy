import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getMiniAppOptimizationSettings } from "@/lib/miniappOptimization";
import { parseTargetingList } from "@/lib/advertiserTargeting";
import { calculateMiniAppPublisherPayout } from "@/lib/miniappPublisherCpmEngine";
import { getAdvertiserTrustMultipliers, normalizeAdvertiserTrustLevel, qualityMultiplier } from "@/lib/advertiserTrust";
import {
  calculateAdvertiserPerformanceScore,
  calculateCampaignPriorityScore,
  getDeliveryOptimizationSettings
} from "@/lib/inventoryOptimization";
import { qualityScoreForWatchTier, watchDurationQualityTier, type WatchQualityTier } from "@/lib/internalAdCompletionQuality";
import { campaignExcludesIdentifier, loadCampaignExclusions } from "@/lib/campaignInventoryExclusions";

export const INTERNAL_NETWORK_NAME = "AdsGalaxyInternal";

type CampaignRow = RowDataPacket & {
  id: number;
  advertiser_id: number;
  campaign_name: string;
  title: string;
  description: string;
  cta_text: string | null;
  title_color: string | null;
  body_color: string | null;
  categories: string | null;
  image_url: string | null;
  logo_url: string | null;
  landing_url: string;
  remaining_budget: string | number;
  budget: string | number;
  total_spend: string | number;
  impressions: string | number;
  admin_cpm: string | number;
  advertiser_cpm_bid: string | number;
  cpm_mode: string | null;
  fixed_publisher_cpm: string | number | null;
  campaign_budget_mode: string | null;
  quality_score: string | number;
  advertiser_trust_level: string;
  target_countries: string | null;
  countries: string | null;
  start_at: string | Date | null;
  end_at: string | Date | null;
  daily_budget_limit: string | number | null;
  frequency_cap_per_user: string | number | null;
};

type MiniAppInventoryRow = RowDataPacket & {
  inventory_score: string | number;
  inventory_rank: string;
  inventory_override: string;
};

type ExistingImpressionRow = RowDataPacket & {
  advertiser_cpm: string | number;
  cost: string | number;
  publisher_revenue: string | number;
  ads_galaxy_revenue: string | number;
  reserve_revenue: string | number;
  publisher_cpm: string | number;
};

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

function normalizeCountryList(value: string | null) {
  return String(value || "")
    .split(",")
    .map((country) => country.trim().toUpperCase())
    .filter(Boolean);
}

function dateIsAfterNow(value: string | Date | null) {
  if (!value) return false;
  return new Date(value).getTime() > Date.now();
}

function dateIsBeforeNow(value: string | Date | null) {
  if (!value) return false;
  return new Date(value).getTime() < Date.now();
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
  const deliverySettings = await getDeliveryOptimizationSettings(input.conn);
  const trustMultipliers = await getAdvertiserTrustMultipliers(input.conn);
  const cap = await canServeInternalAd(input.miniappId, input.conn);
  if (!cap.allowed) return { campaign: null, skip_reason: cap.reason };

  const [[inventoryRow]] = await input.conn.query<MiniAppInventoryRow[]>(
    "SELECT COALESCE(inventory_score, 50) as inventory_score, COALESCE(inventory_rank, 'standard') as inventory_rank, COALESCE(inventory_override, 'none') as inventory_override FROM miniapps WHERE id = ?",
    [input.miniappId]
  );
  if (inventoryRow?.inventory_override === "blacklist" || inventoryRow?.inventory_override === "pause") {
    return { campaign: null, skip_reason: "inventory_paused_by_admin" };
  }

  const [campaigns] = await input.conn.query<CampaignRow[]>(`
    SELECT
      c.id, c.advertiser_id, c.campaign_name, c.title, c.description, c.cta_text, c.title_color, c.body_color, c.categories, c.image_url, c.logo_url, c.landing_url, c.budget,
      remaining_budget, total_spend, impressions, admin_cpm, advertiser_cpm_bid, cpm_mode, fixed_publisher_cpm,
      campaign_budget_mode, target_countries, countries, start_at,
      end_at, daily_budget_limit, frequency_cap_per_user, c.quality_score,
      COALESCE(u.advertiser_trust_level, 'new') as advertiser_trust_level
    FROM miniapp_rewarded_campaigns c
    JOIN users u ON c.advertiser_id = u.id
    WHERE c.status = 'approved'
      AND c.remaining_budget > 0
      AND COALESCE(u.advertiser_trust_level, 'new') != 'restricted'
      AND c.advertiser_cpm_bid > 0
      AND (c.start_at IS NULL OR c.start_at <= NOW())
      AND (c.end_at IS NULL OR c.end_at >= NOW())
    ORDER BY c.created_at ASC, c.id ASC
    LIMIT 50
    FOR UPDATE
  `);
  campaigns.sort((a, b) => {
    const aTrust = trustMultipliers[normalizeAdvertiserTrustLevel(a.advertiser_trust_level)] || 1;
    const bTrust = trustMultipliers[normalizeAdvertiserTrustLevel(b.advertiser_trust_level)] || 1;
    const aAdvertiser = calculateAdvertiserPerformanceScore({ trustLevel: a.advertiser_trust_level, campaignQuality: a.quality_score, spend: a.budget, approvedCampaigns: 1 });
    const bAdvertiser = calculateAdvertiserPerformanceScore({ trustLevel: b.advertiser_trust_level, campaignQuality: b.quality_score, spend: b.budget, approvedCampaigns: 1 });
    const aPriority = calculateCampaignPriorityScore({ advertiserTrustMultiplier: aTrust, campaignQuality: a.quality_score, cpmBid: a.advertiser_cpm_bid, advertiserPerformance: aAdvertiser, historicalPerformance: 50 });
    const bPriority = calculateCampaignPriorityScore({ advertiserTrustMultiplier: bTrust, campaignQuality: b.quality_score, cpmBid: b.advertiser_cpm_bid, advertiserPerformance: bAdvertiser, historicalPerformance: 50 });
    const inventoryScore = toNumber(inventoryRow?.inventory_score || 50);
    const aMatch = 1 - Math.abs(aPriority - inventoryScore) / 100;
    const bMatch = 1 - Math.abs(bPriority - inventoryScore) / 100;
    const modeWeight = deliverySettings.mode === "performance" ? 1.35 : deliverySettings.mode === "growth" ? 0.9 : 1;
    const aScore = toNumber(a.advertiser_cpm_bid) * aTrust * qualityMultiplier(a.quality_score) * (aPriority / 50) * (0.8 + aMatch * 0.4) * modeWeight;
    const bScore = toNumber(b.advertiser_cpm_bid) * bTrust * qualityMultiplier(b.quality_score) * (bPriority / 50) * (0.8 + bMatch * 0.4) * modeWeight;
    return bScore - aScore;
  });

  const country = input.country?.toUpperCase() || null;
  let skipReason = "no_internal_campaign";
  let campaign: CampaignRow | undefined;
  const [[miniappRow]] = await input.conn.query<RowDataPacket[]>("SELECT miniapp_username FROM miniapps WHERE id = ? LIMIT 1", [input.miniappId]);
  const miniappExclusions = await loadCampaignExclusions(input.conn, "miniapp", campaigns.map((item) => Number(item.id)), "miniapp");

  for (const row of campaigns) {
    if (campaignExcludesIdentifier(miniappExclusions, Number(row.id), miniappRow?.miniapp_username)) {
      skipReason = "advertiser_excluded_miniapp";
      continue;
    }
    if (dateIsAfterNow(row.start_at)) {
      skipReason = "targeting_schedule_not_started";
      continue;
    }
    if (dateIsBeforeNow(row.end_at)) {
      skipReason = "targeting_schedule_ended";
      continue;
    }

    const jsonTargets = parseTargetingList(row.countries).map((countryCode) => countryCode.toUpperCase());
    const targets = jsonTargets.length > 0 ? jsonTargets : normalizeCountryList(row.target_countries);
    if (targets.length > 0 && country && !targets.includes(country)) {
      skipReason = "country_not_targeted";
      continue;
    }

    const cpm = toNumber(row.advertiser_cpm_bid);
    const cost = Number((cpm / 1000).toFixed(8));
    const [[balanceRow]] = await input.conn.query<RowDataPacket[]>(
      "SELECT ad_balance FROM users WHERE id = ?",
      [row.advertiser_id]
    );
    if (toNumber(balanceRow?.ad_balance) < cost) {
      await input.conn.query(
        "UPDATE miniapp_rewarded_campaigns SET status = 'paused', pause_reason = 'insufficient_balance' WHERE id = ? AND status = 'approved'",
        [row.id]
      );
      skipReason = "insufficient_advertiser_balance";
      continue;
    }

    if (input.telegramUserId) {
      const frequencyCap = Number(row.frequency_cap_per_user || 0);
      if (frequencyCap > 0) {
        const [[frequencyRow]] = await input.conn.query<RowDataPacket[]>(
          `SELECT COUNT(*) as seen
           FROM miniapp_internal_ad_impressions
           WHERE campaign_id = ?
             AND telegram_user_id = ?
             AND created_at >= CURDATE()`,
          [row.id, input.telegramUserId]
        );
        if (Number(frequencyRow?.seen || 0) >= frequencyCap) {
          skipReason = "targeting_frequency_cap";
          continue;
        }
      }

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

    const budget = toNumber(row.budget);
    const remainingBudget = toNumber(row.remaining_budget);
    if (remainingBudget + 1e-10 < cost) {
      skipReason = "campaign_budget_exhausted";
      continue;
    }
    if (budget > 0) {
      const [[miniappSpendRow]] = await input.conn.query<RowDataPacket[]>(
        "SELECT COALESCE(SUM(cost), 0) as spend FROM miniapp_internal_ad_impressions WHERE campaign_id = ? AND miniapp_id = ?",
        [row.id, input.miniappId]
      );
      const miniappShare = toNumber(miniappSpendRow?.spend) / budget * 100;
      if (miniappShare >= settings.internal_campaign_miniapp_max_share_percent) {
        skipReason = "internal_campaign_miniapp_share_cap";
        continue;
      }
    }

    const [[pacingRow]] = await input.conn.query<RowDataPacket[]>(`
      SELECT
        COALESCE(SUM(CASE WHEN created_at >= CURDATE() THEN cost ELSE 0 END), 0) as daily_spend,
        COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR) THEN cost ELSE 0 END), 0) as hourly_spend,
        COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE) THEN cost ELSE 0 END), 0) as rolling_spend
      FROM miniapp_internal_ad_impressions
      WHERE campaign_id = ?
    `, [row.id]);
    const dailyBudgetLimit = toNumber(row.daily_budget_limit);
    if (dailyBudgetLimit > 0 && toNumber(pacingRow?.daily_spend) + cost > dailyBudgetLimit) {
      skipReason = "daily_budget_limit";
      continue;
    }
    if (budget > 0) {
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
    }

    campaign = row;
    break;
  }

  if (!campaign) return { campaign: null, skip_reason: skipReason };

  const cpm = toNumber(campaign.advertiser_cpm_bid);
  const cost = Number((cpm / 1000).toFixed(8));

  return {
    campaign: {
      id: Number(campaign.id),
      campaign_name: campaign.campaign_name,
      title: campaign.title,
      description: campaign.description,
      cta_text: campaign.cta_text || "Learn More",
      title_color: campaign.title_color || null,
      body_color: campaign.body_color || null,
      categories: campaign.categories || null,
      image_url: campaign.image_url,
      logo_url: campaign.logo_url,
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
  watchDurationSeconds?: number;
  completionQualityTier?: WatchQualityTier;
  completionQualityScore?: number;
  completionStatus?: string;
}) {
  const [campaignRows] = await input.conn.query<CampaignRow[]>(
    `SELECT id, advertiser_id, advertiser_cpm_bid, cpm_mode, fixed_publisher_cpm,
       remaining_budget, daily_budget_limit
     FROM miniapp_rewarded_campaigns
     WHERE id = ? AND status = 'approved'
     FOR UPDATE`,
    [input.campaignId]
  );

  if (campaignRows.length === 0) {
    throw new Error("Internal campaign is not available");
  }

  const campaign = campaignRows[0];
  const [existingRows] = await input.conn.query<ExistingImpressionRow[]>(
    `SELECT advertiser_cpm, cost, publisher_revenue, ads_galaxy_revenue, reserve_revenue, publisher_cpm
     FROM miniapp_internal_ad_impressions WHERE request_id = ? FOR UPDATE`,
    [input.requestId]
  );
  if (existingRows.length > 0) {
    const existing = existingRows[0];
    return {
      duplicate: true,
      insufficient_balance: false,
      cpm: toNumber(existing.advertiser_cpm),
      cost: toNumber(existing.cost),
      ads_galaxy_fee: toNumber(existing.ads_galaxy_revenue),
      reserve_revenue: toNumber(existing.reserve_revenue),
      publisher_revenue: toNumber(existing.publisher_revenue),
      publisher_cpm: toNumber(existing.publisher_cpm),
    };
  }

  const [[billingMiniapp]] = await input.conn.query<RowDataPacket[]>("SELECT miniapp_username FROM miniapps WHERE id = ? LIMIT 1", [input.miniappId]);
  const billingExclusions = await loadCampaignExclusions(input.conn, "miniapp", [Number(campaign.id)], "miniapp");
  if (campaignExcludesIdentifier(billingExclusions, Number(campaign.id), billingMiniapp?.miniapp_username)) {
    throw new Error("Internal campaign is excluded from this Mini App");
  }

  const cpm = toNumber(campaign.advertiser_cpm_bid);
  const cost = Number((cpm / 1000).toFixed(8));

  if (cost <= 0) {
    throw new Error("Internal campaign CPM is invalid");
  }

  if (toNumber(campaign.remaining_budget) + 1e-10 < cost) {
    await input.conn.query(
      "UPDATE miniapp_rewarded_campaigns SET status = 'paused', pause_reason = 'budget_exhausted', remaining_budget = GREATEST(remaining_budget, 0) WHERE id = ?",
      [input.campaignId]
    );
    throw new Error("campaign_budget_exhausted");
  }
  if (toNumber(campaign.daily_budget_limit) > 0) {
    const [[dailyRow]] = await input.conn.query<RowDataPacket[]>(
      "SELECT COALESCE(SUM(advertiser_debit), 0) spend FROM miniapp_internal_ad_impressions WHERE campaign_id = ? AND created_at >= CURDATE()",
      [input.campaignId]
    );
    if (toNumber(dailyRow?.spend) + cost > toNumber(campaign.daily_budget_limit) + 1e-10) {
      throw new Error("daily_budget_limit");
    }
  }

  const payout = await calculateMiniAppPublisherPayout({
    conn: input.conn,
    campaignId: input.campaignId,
    miniappId: input.miniappId,
    telegramUserId: input.telegramUserId,
    country: input.country,
    advertiserCpm: cpm,
    cpmMode: campaign.cpm_mode,
    fixedPublisherCpm: campaign.fixed_publisher_cpm === null ? null : toNumber(campaign.fixed_publisher_cpm),
  });
  const watchDurationSeconds = Math.max(0, Number(input.watchDurationSeconds ?? 1.5) || 0);
  const completionQualityTier = input.completionQualityTier || watchDurationQualityTier(watchDurationSeconds, false);
  const completionQualityScore = input.completionQualityScore ?? qualityScoreForWatchTier(completionQualityTier);
  const qualityMetadata = {
    ...payout.quality_metadata,
    completion_model: "15s_internal_rewarded",
    watch_duration_seconds: watchDurationSeconds,
    completion_quality_tier: completionQualityTier,
    completion_quality_score: completionQualityScore,
  };

  const [balanceResult] = await input.conn.query<ResultSetHeader>(
    "UPDATE users SET ad_balance = ad_balance - ? WHERE id = ? AND ad_balance >= ?",
    [cost, campaign.advertiser_id, cost]
  );
  if (balanceResult.affectedRows !== 1) {
    await input.conn.query(
      "UPDATE miniapp_rewarded_campaigns SET status = 'paused', pause_reason = 'insufficient_balance' WHERE id = ?",
      [input.campaignId]
    );
    return { duplicate: false, insufficient_balance: true, cpm, cost };
  }

  await input.conn.query<ResultSetHeader>(
    `INSERT INTO miniapp_internal_ad_impressions
      (
        campaign_id, miniapp_id, request_id, telegram_user_id, country,
        advertiser_cpm, cpm, publisher_cpm, cost, advertiser_debit, publisher_revenue,
        ads_galaxy_revenue, reserve_revenue, quality_factor,
        repeat_penalty_factor, quality_metadata, cpm_mode,
        watch_duration_seconds, completion_status, completion_quality_tier,
        completion_quality_score
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.campaignId,
      input.miniappId,
      input.requestId,
      input.telegramUserId,
      input.country,
      payout.advertiser_cpm,
      cpm,
      payout.publisher_cpm,
      cost,
      cost,
      payout.publisher_revenue,
      payout.ads_galaxy_revenue,
      payout.reserve_revenue,
      payout.quality_factor,
      payout.repeat_penalty_factor,
      JSON.stringify(qualityMetadata),
      payout.cpm_mode,
      watchDurationSeconds,
      input.completionStatus || "impression_recorded",
      completionQualityTier,
      completionQualityScore,
    ]
  );

  const [campaignUpdate] = await input.conn.query<ResultSetHeader>(
    `UPDATE miniapp_rewarded_campaigns
     SET total_spend = total_spend + ?, impressions = impressions + 1,
         remaining_budget = GREATEST(remaining_budget - ?, 0),
         pause_reason = CASE
           WHEN remaining_budget - ? <= 0 THEN 'budget_exhausted'
           WHEN remaining_budget - ? < ? THEN 'insufficient_budget_for_delivery'
           ELSE NULL END,
         status = CASE WHEN remaining_budget - ? < ? THEN 'paused' ELSE status END
     WHERE id = ? AND status = 'approved' AND remaining_budget >= ?`,
    [cost, cost, cost, cost, cost, cost, cost, input.campaignId, cost]
  );
  if (campaignUpdate.affectedRows !== 1) throw new Error("campaign_budget_exhausted");
  await input.conn.query(
    "INSERT INTO advertiser_transactions (user_id, amount, type, description) VALUES (?, ?, 'debit', ?)",
    [campaign.advertiser_id, cost, `Mini App impression ${input.requestId}`]
  );

  const adsGalaxyFee = payout.ads_galaxy_revenue;
  const publisherRevenue = payout.publisher_revenue;
  const [dateRows] = await input.conn.query<Array<RowDataPacket & { stat_date: string }>>(
    "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS stat_date"
  );
  const statDate = String(dateRows[0].stat_date);
  const grossCpm = cpm;

  await input.conn.query(
    `INSERT INTO miniapp_daily_stats
      (miniapp_id, network_name, date, impressions, gross_revenue, ads_galaxy_fee, reserve_revenue, publisher_revenue, gross_cpm, net_cpm,
       revenue_validation_status, revenue_validation_reason, revenue_validation_metadata, revenue_validated_at, revenue_review_status)
     VALUES (?, ?, ?, 1, ?, ?, ?, 0, ?, 0, 'passed', NULL, ?, NOW(), 'not_required')
     ON DUPLICATE KEY UPDATE
      impressions = impressions + 1,
      gross_revenue = gross_revenue + VALUES(gross_revenue),
      ads_galaxy_fee = ads_galaxy_fee + VALUES(ads_galaxy_fee),
      reserve_revenue = reserve_revenue + VALUES(reserve_revenue),
      gross_cpm = (gross_revenue / impressions) * 1000,
      revenue_validation_status = 'passed',
      revenue_validation_reason = NULL,
      revenue_validation_metadata = VALUES(revenue_validation_metadata),
      revenue_validated_at = NOW(),
      revenue_review_status = 'not_required'`,
    [input.miniappId, INTERNAL_NETWORK_NAME, statDate, cost, adsGalaxyFee, payout.reserve_revenue, grossCpm,
      JSON.stringify({ source: "server_internal_impression_ledger", request_id: input.requestId })]
  );

  if (input.country) {
    await input.conn.query(
      `INSERT INTO miniapp_country_stats (miniapp_id, network_name, country, date, impressions)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE impressions = impressions + 1`,
      [input.miniappId, INTERNAL_NETWORK_NAME, input.country, statDate]
    );
  }

  return {
    duplicate: false,
    insufficient_balance: false,
    cpm,
    cost,
    ads_galaxy_fee: adsGalaxyFee,
    reserve_revenue: payout.reserve_revenue,
    publisher_revenue: publisherRevenue,
    publisher_cpm: payout.publisher_cpm,
  };
}
