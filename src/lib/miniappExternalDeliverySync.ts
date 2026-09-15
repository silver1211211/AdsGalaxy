import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { claimAdvertiserDirectDebit } from "@/lib/advertiserDirectDebit";
import pool from "@/lib/db";
import {
  affordableExternalImpressions,
  calculateCumulativeExternalDue,
  calculateSyncProgress,
  decimalToMoneyUnits,
  miniAppImpressionCostUnits,
  moneyUnitsToDecimal,
  wholeNonNegative,
} from "@/lib/miniappExternalDeliveryMath";
import {
  dispatchMiniAppCampaignNotifications,
  enqueueMiniAppBudgetExhaustedNotification,
  markMiniAppCampaignBudgetExhausted,
} from "@/lib/miniappCampaignNotifications";
import { getMiniAppCampaignMetricsByIds } from "@/lib/miniappCampaignMetrics";

type Db = Pick<PoolConnection, "query" | "execute">;

type CampaignRow = RowDataPacket & {
  id: number;
  advertiser_id: number;
  campaign_name: string;
  status: string;
  pause_reason: string | null;
  campaign_budget_mode: string;
  remaining_budget: string;
  total_spend: string;
  impressions: string | number;
  advertiser_cpm_bid: string;
  daily_budget_limit: string | null;
};

type SyncRow = RowDataPacket & {
  id: number;
  campaign_id: number;
  admin_id: number | null;
  status: string;
  starting_platform_impressions: string | number;
  starting_platform_clicks: string | number;
  starting_combined_impressions: string | number;
  starting_combined_clicks: string | number;
  target_impressions: string | number;
  target_clicks: string | number;
  required_external_impressions: string | number;
  required_external_clicks: string | number;
  platform_impressions_during: string | number;
  platform_clicks_during: string | number;
  external_impressions_added: string | number;
  external_clicks_added: string | number;
  external_spend: string | number;
  duration_seconds: number;
  started_at: Date | string | null;
  ends_at: Date | string | null;
  paused_at: Date | string | null;
  total_paused_seconds: number;
  last_processed_at: Date | string | null;
  completed_at: Date | string | null;
  cancelled_at: Date | string | null;
  stop_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export class MiniAppExternalSyncError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

function count(value: unknown) {
  return Math.max(0, Math.floor(Number(value || 0)));
}

function timestamp(value: Date | string | null) {
  if (!value) return 0;
  return new Date(value).getTime();
}

async function getSourceTotals(db: Db, campaignId: number) {
  const metric = (await getMiniAppCampaignMetricsByIds([campaignId], db as unknown as Pick<PoolConnection, "query">)).get(campaignId);
  const platformImpressions = count(metric?.platform_impressions);
  const platformClicks = count(metric?.platform_clicks);
  const externalImpressions = count(metric?.external_impressions);
  const externalClicks = count(metric?.external_clicks);
  return {
    platformImpressions,
    platformClicks,
    externalImpressions,
    externalClicks,
    combinedImpressions: platformImpressions + externalImpressions,
    combinedClicks: platformClicks + externalClicks,
    externalSpend: String(metric?.external_spend || "0.00000000"),
  };
}

function serializeSync(sync: SyncRow | null, totals: Awaited<ReturnType<typeof getSourceTotals>>, nowMs = Date.now()) {
  if (!sync) return null;
  const progress = sync.started_at && sync.ends_at
    ? calculateSyncProgress({
      nowMs,
      startedAtMs: timestamp(sync.started_at),
      endsAtMs: timestamp(sync.ends_at),
      durationSeconds: Number(sync.duration_seconds),
      pausedAtMs: sync.paused_at ? timestamp(sync.paused_at) : null,
    })
    : 0;
  const isActive = ["running", "paused"].includes(sync.status);
  const platformImpressionsDuring = isActive
    ? Math.max(0, totals.platformImpressions - count(sync.starting_platform_impressions))
    : count(sync.platform_impressions_during);
  const platformClicksDuring = isActive
    ? Math.max(0, totals.platformClicks - count(sync.starting_platform_clicks))
    : count(sync.platform_clicks_during);
  const referenceMs = sync.paused_at ? timestamp(sync.paused_at) : nowMs;
  return {
    ...sync,
    starting_platform_impressions: count(sync.starting_platform_impressions),
    starting_platform_clicks: count(sync.starting_platform_clicks),
    starting_combined_impressions: count(sync.starting_combined_impressions),
    starting_combined_clicks: count(sync.starting_combined_clicks),
    target_impressions: count(sync.target_impressions),
    target_clicks: count(sync.target_clicks),
    required_external_impressions: count(sync.required_external_impressions),
    required_external_clicks: count(sync.required_external_clicks),
    platform_impressions_during: platformImpressionsDuring,
    platform_clicks_during: platformClicksDuring,
    external_impressions_added: count(sync.external_impressions_added),
    external_clicks_added: count(sync.external_clicks_added),
    progress_percent: Number((progress * 100).toFixed(2)),
    time_remaining_seconds: Math.max(0, Math.ceil((timestamp(sync.ends_at) - referenceMs) / 1000)),
    remaining_external_impressions: Math.max(0, count(sync.target_impressions) - totals.combinedImpressions),
    remaining_external_clicks: Math.max(0, count(sync.target_clicks) - totals.combinedClicks),
  };
}

export async function getMiniAppExternalDeliveryState(campaignId: number) {
  const [campaigns] = await pool.query<Array<RowDataPacket & {
    id: number;
    campaign_name: string;
    remaining_budget: string | number;
  }>>(
    "SELECT id, campaign_name, remaining_budget FROM miniapp_rewarded_campaigns WHERE id = ?",
    [campaignId],
  );
  if (campaigns.length === 0) throw new MiniAppExternalSyncError("Campaign not found", 404);
  const totals = await getSourceTotals(pool as unknown as Db, campaignId);
  const [jobs] = await pool.query<SyncRow[]>(
    "SELECT * FROM miniapp_external_delivery_syncs WHERE campaign_id = ? ORDER BY id DESC LIMIT 20",
    [campaignId],
  );
  return {
    campaign: {
      ...campaigns[0],
      current_impressions: totals.combinedImpressions,
      current_clicks: totals.combinedClicks,
      platform_impressions: totals.platformImpressions,
      platform_clicks: totals.platformClicks,
      external_impressions: totals.externalImpressions,
      external_clicks: totals.externalClicks,
    },
    sync: serializeSync(jobs[0] || null, totals),
    history: jobs.map((job) => serializeSync(job, totals)),
  };
}

export async function createMiniAppExternalDeliverySync(input: {
  campaignId: number;
  adminId: number;
  targetImpressions: unknown;
  targetClicks: unknown;
  durationSeconds: unknown;
}) {
  let targetImpressions: number;
  let targetClicks: number;
  let durationSeconds: number;
  try {
    targetImpressions = wholeNonNegative(input.targetImpressions, "Target total impressions");
    targetClicks = wholeNonNegative(input.targetClicks, "Target total clicks");
    durationSeconds = wholeNonNegative(input.durationSeconds, "Duration");
  } catch (error) {
    throw new MiniAppExternalSyncError(error instanceof Error ? error.message : "Invalid sync targets");
  }
  if (durationSeconds < 60 || durationSeconds > 2_592_000) {
    throw new MiniAppExternalSyncError("Duration must be between 1 minute and 30 days");
  }
  if (targetClicks > targetImpressions) {
    throw new MiniAppExternalSyncError("Target total clicks cannot exceed target total impressions");
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [campaigns] = await conn.query<CampaignRow[]>(
      `SELECT id, advertiser_id, campaign_name, status, pause_reason, campaign_budget_mode,
              remaining_budget, total_spend, impressions, advertiser_cpm_bid, daily_budget_limit
       FROM miniapp_rewarded_campaigns WHERE id = ? FOR UPDATE`,
      [input.campaignId],
    );
    if (campaigns.length === 0) throw new MiniAppExternalSyncError("Campaign not found", 404);
    if (!["approved", "active", "paused", "completed"].includes(campaigns[0].status)) {
      throw new MiniAppExternalSyncError("Campaign must be approved before external delivery can be synchronized", 409);
    }
    const [active] = await conn.query<SyncRow[]>(
      `SELECT * FROM miniapp_external_delivery_syncs
       WHERE campaign_id = ? AND active_slot = 1 FOR UPDATE`,
      [input.campaignId],
    );
    if (active.length > 0) throw new MiniAppExternalSyncError("An external delivery sync is already active for this campaign", 409);

    const totals = await getSourceTotals(conn, input.campaignId);
    if (targetImpressions < totals.combinedImpressions || targetClicks < totals.combinedClicks) {
      throw new MiniAppExternalSyncError("Targets cannot be below the campaign's current totals");
    }
    if (targetImpressions === totals.combinedImpressions && targetClicks === totals.combinedClicks) {
      throw new MiniAppExternalSyncError("At least one target must be above its current total");
    }

    const [result] = await conn.query<ResultSetHeader>(
      `INSERT INTO miniapp_external_delivery_syncs
       (campaign_id, admin_id, status, active_slot,
        starting_platform_impressions, starting_platform_clicks,
        starting_combined_impressions, starting_combined_clicks,
        target_impressions, target_clicks,
        required_external_impressions, required_external_clicks,
        duration_seconds, started_at, ends_at)
       VALUES (?, ?, 'running', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND))`,
      [
        input.campaignId,
        input.adminId,
        totals.platformImpressions,
        totals.platformClicks,
        totals.combinedImpressions,
        totals.combinedClicks,
        targetImpressions,
        targetClicks,
        targetImpressions - totals.combinedImpressions,
        targetClicks - totals.combinedClicks,
        durationSeconds,
        durationSeconds,
      ],
    );
    await conn.commit();
    return { id: result.insertId, ...(await getMiniAppExternalDeliveryState(input.campaignId)) };
  } catch (error) {
    await conn.rollback();
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      throw new MiniAppExternalSyncError("An external delivery sync is already active for this campaign", 409);
    }
    throw error;
  } finally {
    conn.release();
  }
}

export async function controlMiniAppExternalDeliverySync(input: {
  campaignId: number;
  action: "pause" | "resume" | "cancel";
}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("SELECT id FROM miniapp_rewarded_campaigns WHERE id = ? FOR UPDATE", [input.campaignId]);
    const [jobs] = await conn.query<SyncRow[]>(
      "SELECT * FROM miniapp_external_delivery_syncs WHERE campaign_id = ? AND active_slot = 1 FOR UPDATE",
      [input.campaignId],
    );
    if (jobs.length === 0) throw new MiniAppExternalSyncError("No active external delivery sync was found", 404);
    const job = jobs[0];
    if (input.action === "pause") {
      if (job.status !== "running") throw new MiniAppExternalSyncError("Only a running sync can be paused", 409);
      await conn.query(
        "UPDATE miniapp_external_delivery_syncs SET status = 'paused', paused_at = NOW() WHERE id = ?",
        [job.id],
      );
    } else if (input.action === "resume") {
      if (job.status !== "paused" || !job.paused_at) throw new MiniAppExternalSyncError("Only a paused sync can be resumed", 409);
      await conn.query(
        `UPDATE miniapp_external_delivery_syncs
         SET status = 'running',
             total_paused_seconds = total_paused_seconds + GREATEST(TIMESTAMPDIFF(SECOND, paused_at, NOW()), 0),
             ends_at = DATE_ADD(ends_at, INTERVAL GREATEST(TIMESTAMPDIFF(SECOND, paused_at, NOW()), 0) SECOND),
             paused_at = NULL
         WHERE id = ?`,
        [job.id],
      );
    } else {
      await conn.query(
        `UPDATE miniapp_external_delivery_syncs
         SET status = 'cancelled', active_slot = NULL, cancelled_at = NOW(),
             paused_at = NULL, stop_reason = 'admin_cancelled'
         WHERE id = ?`,
        [job.id],
      );
    }
    await conn.commit();
    return getMiniAppExternalDeliveryState(input.campaignId);
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function processOneSync(syncId: number) {
  const [lookup] = await pool.query<Array<RowDataPacket & { campaign_id: number }>>(
    "SELECT campaign_id FROM miniapp_external_delivery_syncs WHERE id = ? AND status = 'running'",
    [syncId],
  );
  const campaignId = lookup[0]?.campaign_id;
  if (!campaignId) return { syncId, outcome: "inactive" };

  const conn = await pool.getConnection();
  let queuedNotification = false;
  try {
    await conn.beginTransaction();
    const [campaigns] = await conn.query<CampaignRow[]>(
      `SELECT id, advertiser_id, campaign_name, status, pause_reason, campaign_budget_mode,
              remaining_budget, total_spend, impressions, advertiser_cpm_bid, daily_budget_limit
       FROM miniapp_rewarded_campaigns WHERE id = ? FOR UPDATE`,
      [campaignId],
    );
    const [jobs] = await conn.query<SyncRow[]>(
      "SELECT * FROM miniapp_external_delivery_syncs WHERE id = ? AND status = 'running' FOR UPDATE",
      [syncId],
    );
    if (campaigns.length === 0 || jobs.length === 0) {
      await conn.rollback();
      return { syncId, outcome: "inactive" };
    }
    const campaign = campaigns[0];
    const job = jobs[0];
    const totals = await getSourceTotals(conn, campaignId);
    const nowMs = Date.now();
    const progress = calculateSyncProgress({
      nowMs,
      startedAtMs: timestamp(job.started_at),
      endsAtMs: timestamp(job.ends_at),
      durationSeconds: Number(job.duration_seconds),
    });
    const platformImpressionsDuring = Math.max(0, totals.platformImpressions - count(job.starting_platform_impressions));
    const platformClicksDuring = Math.max(0, totals.platformClicks - count(job.starting_platform_clicks));
    const impressionDue = calculateCumulativeExternalDue({
      requiredExternal: count(job.required_external_impressions),
      platformDeliveredDuring: platformImpressionsDuring,
      externalAlreadyAdded: count(job.external_impressions_added),
      progress,
    });
    const rawClickDue = calculateCumulativeExternalDue({
      requiredExternal: count(job.required_external_clicks),
      platformDeliveredDuring: platformClicksDuring,
      externalAlreadyAdded: count(job.external_clicks_added),
      progress,
    });

    const [users] = await conn.query<Array<RowDataPacket & { ad_balance: string }>>(
      "SELECT ad_balance FROM users WHERE id = ? FOR UPDATE",
      [campaign.advertiser_id],
    );
    if (users.length === 0) throw new Error("Advertiser not found");

    const unitCost = miniAppImpressionCostUnits(campaign.advertiser_cpm_bid);
    const remainingBudget = decimalToMoneyUnits(campaign.remaining_budget);
    const advertiserBalance = decimalToMoneyUnits(users[0].ad_balance);
    const dailyLimit = campaign.daily_budget_limit ? decimalToMoneyUnits(campaign.daily_budget_limit) : null;
    let dailyAvailable: bigint | null = null;
    if (dailyLimit !== null && dailyLimit > BigInt(0)) {
      const [dailyRows] = await conn.query<Array<RowDataPacket & { spend: string }>>(
        `SELECT
          COALESCE((SELECT SUM(advertiser_debit) FROM miniapp_internal_ad_impressions WHERE campaign_id = ? AND created_at >= CURDATE()), 0)
          + COALESCE((SELECT SUM(advertiser_debit) FROM miniapp_external_delivery_batches WHERE campaign_id = ? AND created_at >= CURDATE()), 0) AS spend`,
        [campaignId, campaignId],
      );
      dailyAvailable = dailyLimit - decimalToMoneyUnits(dailyRows[0]?.spend || 0);
    }

    let fundedImpressions = impressionDue;
    if (impressionDue > 0) {
      fundedImpressions = affordableExternalImpressions({
        requested: impressionDue,
        unitCost,
        remainingBudget,
        advertiserBalance,
        dailyBudgetAvailable: dailyAvailable,
      });
    }
    const batchCost = unitCost * BigInt(fundedImpressions);
    const combinedImpressionsAfter = totals.combinedImpressions + fundedImpressions;
    const clickCapacity = Math.max(0, combinedImpressionsAfter - totals.combinedClicks);
    const fundedClicks = Math.min(rawClickDue, clickCapacity);

    if (fundedImpressions > 0) {
      const cost = moneyUnitsToDecimal(batchCost);
      const walletDebit = await claimAdvertiserDirectDebit(conn, {
        sourceKey: `miniapp:external:${job.id}:${campaignId}`,
        advertiserId: Number(campaign.advertiser_id),
        campaignId,
        campaignTable: "miniapp_rewarded_campaigns",
        billingType: "miniapp_external",
        amount: cost,
        description: `External Mini App delivery sync #${job.id}: ${fundedImpressions} impressions`,
      });
      if (!walletDebit.ok) throw new Error(walletDebit.duplicate ? "External delivery already billed" : "INSUFFICIENT_AD_BALANCE");
      const [campaignUpdate] = await conn.query<ResultSetHeader>(
        `UPDATE miniapp_rewarded_campaigns
         SET remaining_budget = GREATEST(remaining_budget - ?, 0),
             total_spend = total_spend + ?, impressions = impressions + ?
         WHERE id = ? AND status IN ('approved', 'active', 'paused', 'completed') AND remaining_budget >= ?`,
        [cost, cost, fundedImpressions, campaignId, cost],
      );
      if (campaignUpdate.affectedRows !== 1) throw new Error("Campaign budget changed during external delivery sync");
    }

    if (fundedImpressions > 0 || fundedClicks > 0) {
      await conn.query(
        `INSERT INTO miniapp_external_delivery_batches
         (sync_id, campaign_id, progress_ratio, platform_impressions_snapshot,
          platform_clicks_snapshot, external_impressions_added, external_clicks_added, advertiser_debit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          job.id,
          campaignId,
          progress.toFixed(10),
          totals.platformImpressions,
          totals.platformClicks,
          fundedImpressions,
          fundedClicks,
          moneyUnitsToDecimal(batchCost),
        ],
      );
    }

    const externalImpressionsAfter = count(job.external_impressions_added) + fundedImpressions;
    const externalClicksAfter = count(job.external_clicks_added) + fundedClicks;
    const combinedClicksAfter = totals.combinedClicks + fundedClicks;
    const remainingImpressions = Math.max(0, count(job.target_impressions) - combinedImpressionsAfter);
    const remainingClicks = Math.max(0, count(job.target_clicks) - combinedClicksAfter);
    const remainingBudgetAfter = remainingBudget - batchCost;
    const advertiserBalanceAfter = advertiserBalance - batchCost;
    const cannotFundNext = unitCost <= BigInt(0) || remainingBudgetAfter < unitCost || advertiserBalanceAfter < unitCost;
    const campaignBudgetExhausted = unitCost > BigInt(0)
      ? remainingBudgetAfter < unitCost
      : remainingImpressions > 0;
    const dailyBlocked = dailyAvailable !== null && dailyAvailable - batchCost < unitCost;
    const reachedTargets = remainingImpressions === 0 && remainingClicks === 0;
    let nextStatus = reachedTargets ? "completed" : "running";
    let stopReason: string | null = reachedTargets ? "targets_reached" : null;

    if (!reachedTargets && impressionDue > fundedImpressions && !dailyBlocked) {
      nextStatus = "budget_exhausted";
      stopReason = remainingBudgetAfter < unitCost || unitCost <= BigInt(0)
        ? "campaign_budget_exhausted"
        : "insufficient_advertiser_balance";
    } else if (!reachedTargets && progress >= 1 && (dailyBlocked || cannotFundNext)) {
      nextStatus = "budget_exhausted";
      stopReason = dailyBlocked ? "daily_budget_limit" : "campaign_budget_exhausted";
    } else if (!reachedTargets && progress >= 1) {
      nextStatus = "budget_exhausted";
      stopReason = "target_reconciliation_incomplete";
    }

    if (campaignBudgetExhausted) {
      await markMiniAppCampaignBudgetExhausted(conn, campaignId);
      queuedNotification = true;
      if (!reachedTargets) {
        nextStatus = "budget_exhausted";
        stopReason = "campaign_budget_exhausted";
      }
    } else if (advertiserBalanceAfter < unitCost) {
      await conn.query(
        "UPDATE miniapp_rewarded_campaigns SET status = 'paused', pause_reason = 'insufficient_balance' WHERE id = ?",
        [campaignId],
      );
      if (!reachedTargets) {
        nextStatus = "budget_exhausted";
        stopReason = "insufficient_advertiser_balance";
      }
    }

    await conn.query(
      `UPDATE miniapp_external_delivery_syncs
       SET platform_impressions_during = ?, platform_clicks_during = ?,
           external_impressions_added = ?, external_clicks_added = ?,
           external_spend = external_spend + ?, last_processed_at = NOW(),
           status = ?, active_slot = CASE WHEN ? = 'running' THEN 1 ELSE NULL END,
           completed_at = CASE WHEN ? = 'completed' THEN NOW() ELSE completed_at END,
           stop_reason = ?
       WHERE id = ?`,
      [
        platformImpressionsDuring,
        platformClicksDuring,
        externalImpressionsAfter,
        externalClicksAfter,
        moneyUnitsToDecimal(batchCost),
        nextStatus,
        nextStatus,
        nextStatus,
        stopReason,
        job.id,
      ],
    );

    await conn.commit();
    return {
      syncId,
      campaignId,
      outcome: nextStatus,
      progress,
      impressionsAdded: fundedImpressions,
      clicksAdded: fundedClicks,
      queuedNotification,
    };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function processMiniAppExternalDeliverySyncs(limit = 50) {
  const [jobs] = await pool.query<Array<RowDataPacket & { id: number }>>(
    `SELECT id FROM miniapp_external_delivery_syncs
     WHERE status = 'running' ORDER BY id ASC LIMIT ?`,
    [Math.min(200, Math.max(1, Math.floor(limit)))],
  );
  const results = [];
  for (const job of jobs) {
    try {
      results.push(await processOneSync(Number(job.id)));
    } catch (error) {
      results.push({
        syncId: Number(job.id),
        outcome: "error",
        error: error instanceof Error ? error.message : "Unknown worker error",
      });
    }
  }
  const notifications = await dispatchMiniAppCampaignNotifications(20);
  return { checked: jobs.length, results, notifications };
}

export async function reconcileMiniAppBudgetExhaustion() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<Array<RowDataPacket & { id: number }>>(
      `SELECT id FROM miniapp_rewarded_campaigns
       WHERE status IN ('approved', 'active')
         AND campaign_budget_mode != 'unlimited'
         AND (
           advertiser_cpm_bid <= 0
           OR remaining_budget < ROUND(advertiser_cpm_bid / 1000, 8)
         )
       FOR UPDATE`,
    );
    for (const row of rows) {
      await markMiniAppCampaignBudgetExhausted(conn, Number(row.id));
    }
    await conn.commit();
    return rows.length;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export { enqueueMiniAppBudgetExhaustedNotification };
