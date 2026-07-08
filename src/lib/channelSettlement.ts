import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { aggregateChannelStatistics } from "@/lib/channelStatistics";
import { markCampaignBudgetExhausted } from "@/lib/campaignLifecycle";
import { deleteActiveCampaignPosts, type CampaignPostDeletionSummary } from "@/lib/campaignPostDeletion";
import { creditUserLockedBalance } from "@/lib/earnings";
import { recordPayoutSafetyCheck } from "@/lib/revenueProtection";
import { ensureClassicSettlementColumns } from "@/lib/schemaGuards";
import { sendTelegramMessage } from "@/lib/telegram";
import { getPublisherQuality, type PublisherQualityMetrics } from "@/lib/publisherQuality";
import { runChannelFraudDetection, type ChannelFraudDetectionResult } from "@/lib/channelFraudDetection";
import { enforcePublisherTrust, type PublisherTrustEnforcementResult } from "@/lib/publisherTrustEnforcement";
import { applyChannelFraudBillingPolicy } from "@/lib/channelFraudBilling";
import { refreshCampaignViews } from "@/lib/channelAdminViewRefresh";
import { createSystemLog } from "@/lib/systemLogs";
import { settlePendingChannelPublisherCredits } from "@/lib/channelFastBilling";
import { getChannelUnitPrice, money } from "@/lib/channelBilling";

type SettlementKind = "view" | "click";
type ChannelPayoutPolicy = {
  platformMarginPercent: number;
  safetyReservePercent: number;
};

type ChannelPayoutSplit = {
  advertiserDebit: number;
  platformRevenue: number;
  publisherPoolBeforeReserve: number;
  reserveAmount: number;
  publisherCredit: number;
};

type CandidateRow = RowDataPacket & { post_id: number };
type LockedPost = RowDataPacket & {
  post_id: number;
  campaign_id: number;
  channel_id: number;
  campaign_type: string;
  campaign_name: string;
  advertiser_id: number;
  advertiser_telegram_id: string | number;
  publisher_id: number;
  campaign_status: string;
  budget: string | number;
  daily_budget_limit: string | number | null;
  cpm: string | number;
  cpc: string | number;
  views: string | number;
  settled_views: string | number;
  current_clicks: string | number;
  settled_clicks: string | number;
  channel_status: string;
  publisher_status: string;
  publisher_is_banned: number | boolean;
  settlement_excluded_until: Date | string | null;
};

export type ChannelSettlementDetail = {
  campaign_id: number;
  post_id: number;
  type: SettlementKind;
  old_settled_views: number;
  new_views: number;
  old_settled_clicks: number;
  new_clicks: number;
  amount_debited: number;
  publisher_credited: number;
  publisher_distribution: number;
  platform_revenue: number;
  reserve_amount: number;
  publisher_pool_before_reserve: number;
  platform_margin_percent: number;
  safety_reserve_percent: number;
  publisher_distribution_pool: number;
  publisher_quality_score: number;
  publisher_quality_weight: number;
  quality_holdback: number;
  effective_publisher_cpm: number;
  effective_publisher_cpc: number;
  remaining_budget: number;
  exhausted: boolean;
};

export type ChannelSettlementResult = {
  candidates: number;
  settledPosts: number;
  failedPosts: number;
  failedDetails: Array<{ postId: number; reason: string }>;
  advertiserDebited: number;
  publisherCredited: number;
  platformRevenue: number;
  reserveAmount: number;
  exhaustedCampaigns: number;
  details: ChannelSettlementDetail[];
  deletions: Record<number, CampaignPostDeletionSummary>;
  statisticsAggregation: { statDate: string; postRows: number; channelRows: number } | { error: string } | { skipped: true };
  payoutPolicy: ChannelPayoutPolicy;
  fraudDetection: ChannelFraudDetectionResult | { error: string } | { skipped: true };
  fraudBilling: { fraudPosts: number; excludedUnits: number; adjustedSettlements: number; advertiserCredits: number } | { error: string } | { skipped: true };
  trustEnforcement: PublisherTrustEnforcementResult | { error: string } | { skipped: true };
};

const MAX_POSTS_PER_RUN = Math.min(500, Math.max(1, Number.parseInt(process.env.CHANNEL_SETTLEMENT_BATCH_SIZE || "200", 10) || 200));
const MAX_SETTLEMENT_BATCHES_PER_RUN = Math.max(1, Number.parseInt(process.env.CHANNEL_SETTLEMENT_MAX_BATCHES || "50", 10) || 50);

const amount = money;

function percent(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : fallback;
}

async function channelPayoutPolicy(): Promise<ChannelPayoutPolicy> {
  const [rows] = await pool.query<Array<RowDataPacket & { key: string; value: string }>>(
    "SELECT `key`, value FROM settings WHERE `key` IN ('platform_margin_percent', 'safety_reserve_percent')"
  );
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  return {
    platformMarginPercent: percent(settings.get("platform_margin_percent"), 40),
    safetyReservePercent: percent(settings.get("safety_reserve_percent"), 10),
  };
}

export function calculateChannelPayoutSplit(advertiserDebit: number, policy: ChannelPayoutPolicy): ChannelPayoutSplit {
  const debit = amount(advertiserDebit);
  const platformRevenue = amount(debit * (policy.platformMarginPercent / 100));
  const publisherPoolBeforeReserve = amount(debit - platformRevenue);
  const reserveAmount = amount(publisherPoolBeforeReserve * (policy.safetyReservePercent / 100));
  const publisherCredit = amount(debit - platformRevenue - reserveAmount);
  const difference = Math.abs(debit - publisherCredit - platformRevenue - reserveAmount);
  if (difference > 0.00000001 || publisherCredit > publisherPoolBeforeReserve) {
    throw new Error("invalid_channel_payout_split");
  }
  return { advertiserDebit: debit, platformRevenue, publisherPoolBeforeReserve, reserveAmount, publisherCredit };
}

async function lockedPost(connection: PoolConnection, postId: number) {
  const [rows] = await connection.query<LockedPost[]>(
    `SELECT cp.id AS post_id, cp.campaign_id, cp.channel_id, cp.views, cp.settled_views, cp.settled_clicks,
       c.type AS campaign_type, c.name AS campaign_name, c.user_id AS advertiser_id,
       c.status AS campaign_status, c.budget, c.daily_budget_limit, c.cpm, c.cpc,
       ch.user_id AS publisher_id, ch.status AS channel_status, ch.settlement_excluded_until,
       publisher.status AS publisher_status, publisher.is_banned AS publisher_is_banned,
       u.telegram_id AS advertiser_telegram_id,
       (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id = cp.id) AS current_clicks
     FROM campaign_posts cp
     JOIN campaigns c ON c.id = cp.campaign_id
     JOIN channels ch ON ch.id = cp.channel_id
     JOIN users u ON u.id = c.user_id
     JOIN users publisher ON publisher.id = ch.user_id
     WHERE cp.id = ?
     FOR UPDATE`,
    [postId]
  );
  return rows[0] || null;
}

async function countOutstandingCampaignEngagement(campaignId: number) {
  const [rows] = await pool.query<Array<RowDataPacket & { outstanding_count: number }>>(
    `SELECT COUNT(*) AS outstanding_count
     FROM campaign_posts cp
     JOIN campaigns c ON c.id = cp.campaign_id
     WHERE cp.campaign_id = ?
       AND cp.delivery_confirmed_at IS NOT NULL
       AND cp.delivery_failed_at IS NULL
       AND cp.deleted_at IS NULL
       AND ((c.type = 'views' AND COALESCE(cp.views, 0) > COALESCE(cp.settled_views, 0))
         OR (c.type = 'clicks' AND (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id = cp.id) > COALESCE(cp.settled_clicks, 0)))`,
    [campaignId]
  );
  return Number(rows[0]?.outstanding_count || 0);
}

export async function settleChannelCampaigns(options: {
  channelId?: number;
  campaignId?: number;
  skipGlobalMaintenance?: boolean;
  campaignStatuses?: Array<"active" | "paused">;
} = {}): Promise<ChannelSettlementResult> {
  await ensureClassicSettlementColumns();
  const payoutPolicy = await channelPayoutPolicy();
  const campaignStatuses = options.campaignStatuses?.length ? options.campaignStatuses : ["active", "paused"];
  const campaignStatusPlaceholders = campaignStatuses.map(() => "?").join(",");
  let fraudDetection: ChannelSettlementResult["fraudDetection"];
  let fraudBilling: ChannelSettlementResult["fraudBilling"];
  if (options.skipGlobalMaintenance) {
    // A campaign-scoped, on-demand settlement (e.g. before deleting posts for a
    // single paused/deleted campaign) must not trigger a platform-wide fraud/trust
    // sweep as a side effect of one advertiser's or admin's action. Fraud/quality
    // scoring for the affected posts is still fully respected below via the
    // existing getPublisherQuality() lookup per post; only the periodic, global
    // re-evaluation jobs are skipped here.
    fraudDetection = { skipped: true };
    fraudBilling = { skipped: true };
  } else {
    try {
      fraudDetection = await runChannelFraudDetection();
    } catch (error) {
      fraudDetection = { error: error instanceof Error ? error.message : "channel_fraud_detection_failed" };
      console.error("Pre-settlement channel fraud detection failed", fraudDetection);
    }
    try {
      fraudBilling = await applyChannelFraudBillingPolicy();
    } catch (error) {
      fraudBilling = { error: error instanceof Error ? error.message : "channel_fraud_billing_failed" };
      console.error("Pre-settlement channel fraud billing failed", fraudBilling);
    }
  }

  const details: ChannelSettlementDetail[] = [];
  const failedDetails: ChannelSettlementResult["failedDetails"] = [];
  const exhausted = new Map<number, { name: string; telegramId: string | number }>();
  const qualityByChannel = new Map<number, PublisherQualityMetrics>();
  let failedPosts = 0;
  let totalCandidates = 0;
  let batchCount = 0;
  let lastCandidatePostId = 0;

  const fetchCandidates = () => pool.query<CandidateRow[]>(
    `SELECT cp.id AS post_id
     FROM campaign_posts cp
     JOIN campaigns c ON c.id = cp.campaign_id
     JOIN channels ch ON ch.id = cp.channel_id
     JOIN users publisher ON publisher.id = ch.user_id
     WHERE c.status IN (${campaignStatusPlaceholders})
       AND ch.status = 'active'
       AND ch.is_deleted = FALSE
       AND (ch.settlement_excluded_until IS NULL OR ch.settlement_excluded_until <= NOW())
       AND COALESCE(publisher.is_banned,0)=0
       AND COALESCE(publisher.status,'active')<>'banned'
       AND cp.delivery_confirmed_at IS NOT NULL
       AND cp.delivery_failed_at IS NULL
       AND cp.deleted_at IS NULL
       AND cp.id > ?
       AND (? IS NULL OR cp.channel_id = ?)
       AND (? IS NULL OR cp.campaign_id = ?)
       AND ((c.type = 'views' AND COALESCE(cp.views, 0) > COALESCE(cp.settled_views, 0))
         OR (c.type = 'clicks' AND (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id = cp.id) > COALESCE(cp.settled_clicks, 0)))
     ORDER BY cp.id ASC LIMIT ${MAX_POSTS_PER_RUN}`,
    [
      ...campaignStatuses,
      lastCandidatePostId,
      options.channelId || null,
      options.channelId || null,
      options.campaignId || null,
      options.campaignId || null,
    ]
  );

  while (batchCount < MAX_SETTLEMENT_BATCHES_PER_RUN) {
    const [candidates] = await fetchCandidates();
    if (candidates.length === 0) break;
    batchCount += 1;
    totalCandidates += candidates.length;
    lastCandidatePostId = Number(candidates[candidates.length - 1].post_id || lastCandidatePostId);

    for (const candidate of candidates) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const post = await lockedPost(connection, candidate.post_id);
        if (!post || !campaignStatuses.includes(post.campaign_status as "active" | "paused") || post.channel_status !== "active"
          || Number(post.publisher_is_banned) === 1 || post.publisher_status === "banned"
          || (post.settlement_excluded_until && new Date(post.settlement_excluded_until).getTime() > Date.now())) {
          await connection.rollback();
          continue;
        }

        const kind: SettlementKind = post.campaign_type === "clicks" ? "click" : "view";
        const oldViews = Number(post.settled_views || 0);
        const totalViews = Number(post.views || 0);
        const oldClicks = Number(post.settled_clicks || 0);
        const totalClicks = Number(post.current_clicks || 0);
        const dueUnits = kind === "view" ? totalViews - oldViews : totalClicks - oldClicks;
        const unitPrice = getChannelUnitPrice({ type: post.campaign_type, cpm: post.cpm, cpc: post.cpc });
        const currentBudget = Number(post.budget || 0);

        if (dueUnits <= 0) {
          await connection.rollback();
          continue;
        }
        if (!Number.isFinite(unitPrice) || unitPrice <= 0 || currentBudget <= 0) {
          if (currentBudget <= 0) await markCampaignBudgetExhausted(post.campaign_id, connection);
          else await connection.query("UPDATE campaigns SET status='paused', pause_reason='invalid_unit_price' WHERE id=?", [post.campaign_id]);
          await connection.commit();
          if (currentBudget <= 0) exhausted.set(post.campaign_id, { name: post.campaign_name, telegramId: post.advertiser_telegram_id });
          continue;
        }

        const [[todaySpendRow]] = await connection.query<Array<RowDataPacket & { spend: string | number }>>(
          `SELECT COALESCE((SELECT SUM(advertiser_debit) FROM channel_settlement_ledger WHERE campaign_id=? AND created_at>=CURDATE()),0)
            + COALESCE((SELECT SUM(advertiser_debit) FROM channel_advertiser_debits WHERE campaign_id=? AND created_at>=CURDATE()),0) spend`,
          [post.campaign_id, post.campaign_id]
        );
        const dailyBudget = Number(post.daily_budget_limit || 0);
        const dailyRemaining = dailyBudget > 0
          ? Math.max(0, dailyBudget - Number(todaySpendRow?.spend || 0))
          : Number.POSITIVE_INFINITY;
        const allowedBudget = Math.min(currentBudget, dailyRemaining);
        const affordableUnits = Math.max(0, Math.floor((allowedBudget + 1e-10) / unitPrice));
        const settledUnits = Math.min(dueUnits, affordableUnits);
        if (settledUnits <= 0) {
          if (currentBudget + 1e-10 < unitPrice) {
            await connection.query(
              "UPDATE campaigns SET status='paused', pause_reason='insufficient_budget_for_delivery' WHERE id=? AND status='active'",
              [post.campaign_id]
            );
            await connection.commit();
          } else {
            await connection.rollback();
          }
          continue;
        }

        const debit = amount(settledUnits * unitPrice);
        const split = calculateChannelPayoutSplit(debit, payoutPolicy);
        let quality = qualityByChannel.get(post.channel_id);
        if (!quality) {
          quality = await getPublisherQuality(post.channel_id, connection);
          qualityByChannel.set(post.channel_id, quality);
        }
        const publisherCredit = amount(split.publisherCredit * quality.qualityWeight);
        const qualityHoldback = amount(split.publisherCredit - publisherCredit);
        const reserve = amount(debit - split.platformRevenue - publisherCredit);
        const platform = split.platformRevenue;
        const effectivePublisherCpm = kind === "view" && settledUnits > 0 ? amount((publisherCredit / settledUnits) * 1000) : 0;
        const effectivePublisherCpc = kind === "click" && settledUnits > 0 ? amount(publisherCredit / settledUnits) : 0;
        const settledThrough = (kind === "view" ? oldViews : oldClicks) + settledUnits;
        const remaining = amount(currentBudget - debit);
        const isExhausted = remaining < unitPrice || remaining <= 0;

        const safety = await recordPayoutSafetyCheck({
          settlementType: kind,
          campaignId: post.campaign_id,
          publisherId: post.publisher_id,
          advertiserPaid: debit,
          publisherShare: publisherCredit,
          platformShare: platform,
          reserveShare: reserve,
          expectedPublisherShare: amount(
            debit * (1 - payoutPolicy.platformMarginPercent / 100)
            * (1 - payoutPolicy.safetyReservePercent / 100)
            * quality.qualityWeight
          ),
          expectedPlatformShare: amount(debit * (payoutPolicy.platformMarginPercent / 100)),
          expectedReserveShare: amount(debit -
            amount(debit * (payoutPolicy.platformMarginPercent / 100)) -
            amount(debit * (1 - payoutPolicy.platformMarginPercent / 100)
              * (1 - payoutPolicy.safetyReservePercent / 100) * quality.qualityWeight)),
          metadata: { post_id: post.post_id, units: settledUnits, settled_through: settledThrough },
        });
        if (safety.status !== "passed") {
          await connection.rollback();
          failedPosts += 1;
          failedDetails.push({ postId: post.post_id, reason: "payout_safety_check_failed" });
          continue;
        }

        const [campaignUpdate] = await connection.query(
          `UPDATE campaigns SET budget = ?, channel_spend = channel_spend + ?,
             channel_publisher_earnings = channel_publisher_earnings + ?,
             channel_platform_revenue = channel_platform_revenue + ?,
             channel_reserve_amount = channel_reserve_amount + ?
           WHERE id = ? AND status IN (${campaignStatusPlaceholders})`,
          [remaining, debit, publisherCredit, platform, reserve, post.campaign_id, ...campaignStatuses]
        );
        if (!("affectedRows" in campaignUpdate) || campaignUpdate.affectedRows !== 1) throw new Error("campaign_debit_failed");

        if (!(await creditUserLockedBalance(connection, post.publisher_id, publisherCredit))) throw new Error("publisher_credit_failed");

        const settlementTable = kind === "view" ? "ad_settlements_views" : "ad_settlements";
        const metricColumn = kind === "view" ? "views_count" : "clicks_count";
        await connection.query(
          `INSERT INTO ${settlementTable}
            (post_id, campaign_id, advertiser_id, channel_id, publisher_id, ${metricColumn}, advertiser_paid,
             publisher_reward, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'locked')`,
          [post.post_id, post.campaign_id, post.advertiser_id, post.channel_id, post.publisher_id,
            settledUnits, debit, publisherCredit]
        );

        await connection.query(
          `INSERT INTO channel_settlement_ledger
            (settlement_type, campaign_id, post_id, channel_id, publisher_id, old_settled_count, new_units,
             settled_through, advertiser_debit, platform_margin_percent, publisher_pool_before_reserve,
             safety_reserve_percent, publisher_distribution_pool, publisher_quality_score,
             publisher_quality_weight, quality_holdback,
             publisher_credit, publisher_distribution, effective_publisher_cpm, effective_publisher_cpc,
             platform_revenue, reserve_amount,
             remaining_budget, exhausted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [kind, post.campaign_id, post.post_id, post.channel_id, post.publisher_id,
            kind === "view" ? oldViews : oldClicks, settledUnits, settledThrough, debit,
            payoutPolicy.platformMarginPercent, split.publisherPoolBeforeReserve, payoutPolicy.safetyReservePercent,
            split.publisherCredit, quality.qualityScore, quality.qualityWeight, qualityHoldback,
            publisherCredit, publisherCredit, effectivePublisherCpm, effectivePublisherCpc,
            platform, reserve, isExhausted ? 0 : remaining, isExhausted]
        );

        const settledColumn = kind === "view" ? "settled_views" : "settled_clicks";
        await connection.query(
          `UPDATE campaign_posts SET ${settledColumn} = ?, spend = spend + ?,
             publisher_earnings = publisher_earnings + ?, platform_revenue = platform_revenue + ?,
             reserve_amount = reserve_amount + ? WHERE id = ?`,
          [settledThrough, debit, publisherCredit, platform, reserve, post.post_id]
        );
        await connection.query("UPDATE channels SET last_successful_settlement_at=NOW() WHERE id=?", [post.channel_id]);

        if (isExhausted && post.campaign_status === "active") {
          await markCampaignBudgetExhausted(post.campaign_id, connection);
          exhausted.set(post.campaign_id, { name: post.campaign_name, telegramId: post.advertiser_telegram_id });
        }
        await connection.commit();

        const detail: ChannelSettlementDetail = {
          campaign_id: post.campaign_id, post_id: post.post_id, type: kind,
          old_settled_views: oldViews, new_views: kind === "view" ? settledUnits : 0,
          old_settled_clicks: oldClicks, new_clicks: kind === "click" ? settledUnits : 0,
          amount_debited: debit, publisher_credited: publisherCredit, platform_revenue: platform,
          publisher_distribution: publisherCredit,
          reserve_amount: reserve, publisher_pool_before_reserve: split.publisherPoolBeforeReserve,
          platform_margin_percent: payoutPolicy.platformMarginPercent,
          safety_reserve_percent: payoutPolicy.safetyReservePercent,
          publisher_distribution_pool: split.publisherCredit,
          publisher_quality_score: quality.qualityScore,
          publisher_quality_weight: quality.qualityWeight,
          quality_holdback: qualityHoldback,
          effective_publisher_cpm: effectivePublisherCpm,
          effective_publisher_cpc: effectivePublisherCpc,
          remaining_budget: isExhausted ? 0 : remaining, exhausted: isExhausted,
        };
        details.push(detail);
        console.info("Channel campaign settlement", detail);
      } catch (error) {
        await connection.rollback().catch(() => undefined);
        failedPosts += 1;
        failedDetails.push({ postId: Number(candidate.post_id), reason: error instanceof Error ? error.message : "unknown_error" });
        console.error("Channel campaign settlement failed", {
          post_id: candidate.post_id,
          error: error instanceof Error ? error.message : "unknown_error",
        });
      } finally {
        connection.release();
      }
    }
  }

  const deletions: Record<number, CampaignPostDeletionSummary> = {};
  for (const [campaignId, campaign] of exhausted) {
    const outstandingEngagement = await countOutstandingCampaignEngagement(campaignId);
    if (outstandingEngagement > 0) {
      console.warn("Skipping exhausted campaign post deletion because unsettled engagement remains", {
        campaign_id: campaignId,
        outstanding_posts: outstandingEngagement,
      });
      continue;
    }
    deletions[campaignId] = await deleteActiveCampaignPosts(campaignId);
    await sendTelegramMessage(campaign.telegramId, `Campaign Budget Exhausted\n\nYour campaign "${campaign.name}" has exhausted its budget and its active channel posts were removed.`);
  }

  let statisticsAggregation: ChannelSettlementResult["statisticsAggregation"];
  let trustEnforcement: ChannelSettlementResult["trustEnforcement"];
  if (options.skipGlobalMaintenance) {
    // Same rationale as above: statistics aggregation and trust enforcement are
    // periodic, platform-wide jobs and must not be re-triggered synchronously by
    // a single campaign's pause/delete action.
    statisticsAggregation = { skipped: true };
    trustEnforcement = { skipped: true };
  } else {
    try {
      statisticsAggregation = await aggregateChannelStatistics();
    } catch (error) {
      statisticsAggregation = { error: error instanceof Error ? error.message : "statistics_aggregation_failed" };
    }

    try {
      trustEnforcement = await enforcePublisherTrust();
    } catch (error) {
      trustEnforcement = { error: error instanceof Error ? error.message : "publisher_trust_enforcement_failed" };
      console.error("Post-settlement publisher trust enforcement failed", trustEnforcement);
    }
  }

  return {
    candidates: totalCandidates,
    settledPosts: details.length,
    failedPosts,
    failedDetails,
    advertiserDebited: amount(details.reduce((sum, item) => sum + item.amount_debited, 0)),
    publisherCredited: amount(details.reduce((sum, item) => sum + item.publisher_credited, 0)),
    platformRevenue: amount(details.reduce((sum, item) => sum + item.platform_revenue, 0)),
    reserveAmount: amount(details.reduce((sum, item) => sum + item.reserve_amount, 0)),
    exhaustedCampaigns: exhausted.size,
    details,
    deletions,
    statisticsAggregation,
    payoutPolicy,
    fraudDetection,
    fraudBilling,
    trustEnforcement,
  };
}

export type CampaignSettlementBeforeDeletionAction = "advertiser_pause" | "admin_pause" | "admin_delete";

export type CampaignSettlementBeforeDeletionResult = {
  ok: boolean;
  campaignId: number;
  skipped: boolean;
  viewRefresh: { checked: number; updated: number; failed: number } | null;
  postsSettled: number;
  failedPosts: number;
  failedDetails: Array<{ postId: number; reason: string }>;
  outstandingPosts: number;
  amountDebited: number;
  publisherCredited: number;
  error?: string;
};

type SettlementCampaignRow = RowDataPacket & { id: number; type: string; status: string };

// Settles any outstanding, already-delivered (but not yet billed) views/clicks for a
// single channel campaign before its active posts are removed due to a manual pause
// or delete, so a publisher is not silently unpaid for engagement the advertiser
// already received. Reuses the exact same locked, idempotent, budget- and
// quality-aware settlement transaction as the regular settlement cron
// (settleChannelCampaigns). It does not introduce a second accounting path.
//
// This intentionally does not touch bot broadcast campaigns, Mini App campaigns,
// PQI/fraud scoring, or the periodic settlement cron itself; callers are expected
// to only invoke this for channel-type (views/clicks) campaigns.
export async function settleCampaignEngagementBeforeDeletion(
  campaignId: number,
  actionType: CampaignSettlementBeforeDeletionAction,
  options: { includePausedCampaign?: boolean } = {}
): Promise<CampaignSettlementBeforeDeletionResult> {
  const [rows] = await pool.query<SettlementCampaignRow[]>(
    "SELECT id, type, status FROM campaigns WHERE id = ?",
    [campaignId]
  );
  const campaign = rows[0];

  if (!campaign || campaign.type === "broadcast") {
    return {
      ok: true, campaignId, skipped: true, viewRefresh: null,
      outstandingPosts: 0,
      postsSettled: 0, failedPosts: 0, failedDetails: [], amountDebited: 0, publisherCredited: 0,
    };
  }

  let viewRefresh: CampaignSettlementBeforeDeletionResult["viewRefresh"] = null;
  if (campaign.type === "views") {
    try {
      const refreshed = await refreshCampaignViews(campaignId);
      viewRefresh = { checked: refreshed.checked, updated: refreshed.updated, failed: refreshed.failed };
    } catch (error) {
      // Best-effort only: a failed live view refresh must not block settlement.
      // Settlement proceeds with whatever view count the last successful
      // cron run already recorded.
      console.warn("Pre-deletion view refresh failed; settling with last known views", {
        campaign_id: campaignId,
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  let result: ChannelSettlementResult | null = null;
  let pendingCredits: Awaited<ReturnType<typeof settlePendingChannelPublisherCredits>> | null = null;
  let settlementError: string | undefined;
  try {
    pendingCredits = await settlePendingChannelPublisherCredits({ campaignId, limit: 5000 });
    const [[remainingFastDebits]] = await pool.query<Array<RowDataPacket & { pending_count: number | string }>>(
      "SELECT COUNT(*) AS pending_count FROM channel_advertiser_debits WHERE campaign_id=? AND publisher_status='pending'",
      [campaignId]
    );
    if (Number(remainingFastDebits?.pending_count || 0) > 0) {
      throw new Error("pending_fast_debit_publisher_credit_failed");
    }
    result = await settleChannelCampaigns({
      campaignId,
      skipGlobalMaintenance: true,
      campaignStatuses: options.includePausedCampaign ? ["active", "paused"] : ["active"],
    });
  } catch (error) {
    settlementError = error instanceof Error ? error.message : "channel_settlement_failed";
    console.error("Pre-deletion campaign settlement failed", { campaign_id: campaignId, action_type: actionType, error: settlementError });
  }

  const postsSettled = result?.settledPosts ?? 0;
  const failedPosts = result?.failedPosts ?? (settlementError ? 1 : 0);
  const failedDetails = result?.failedDetails ?? [];
  const amountDebited = result?.advertiserDebited ?? 0;
  const publisherCredited = result?.publisherCredited ?? 0;
  const outstandingPosts = settlementError ? 0 : await countOutstandingCampaignEngagement(campaignId);
  const ok = !settlementError && failedPosts === 0 && outstandingPosts === 0;

  await createSystemLog({
    logType: "channel_campaign_pause_delete_settlement",
    status: ok ? "success" : (postsSettled > 0 ? "partial_failure" : "failed"),
    title: `Channel campaign ${actionType} settlement`,
    summary: ok
      ? `Settled ${postsSettled} post(s) before ${actionType} for campaign ${campaignId}.`
      : `Settlement had ${failedPosts} failure(s) and ${outstandingPosts} outstanding post(s) before ${actionType} for campaign ${campaignId}; deletion withheld.`,
    successCount: postsSettled,
    failedCount: failedPosts,
    failureReasons: settlementError ? { channel_settlement_failed: 1 } : null,
    affectedEntities: [{ campaign_id: campaignId }],
    metadata: {
      campaign_id: campaignId,
      action_type: actionType,
      posts_settled: postsSettled,
      amount_debited: amountDebited,
      publisher_credited: publisherCredited,
      pending_fast_debit_credits: pendingCredits,
      view_refresh: viewRefresh,
      error: settlementError || null,
      failed_details: failedDetails,
      outstanding_posts: outstandingPosts,
    },
  }).catch((error: unknown) => {
    console.error("Failed to record pre-deletion settlement system log", {
      campaign_id: campaignId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
  });

  return {
    ok,
    campaignId,
    skipped: false,
    viewRefresh,
    postsSettled,
    failedPosts,
    failedDetails,
    outstandingPosts,
    amountDebited,
    publisherCredited,
    error: settlementError,
  };
}
