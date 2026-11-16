import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { creditSettledPublisherBalance, isZeroOrdinaryLockEnabled } from "@/lib/earnings";
import { recordReferralCommission } from "@/lib/referralCommission";
import { getPublisherQuality } from "@/lib/publisherQuality";
import { recordPayoutSafetyCheck } from "@/lib/revenueProtection";
import { getChannelBidPerThousand, getChannelUnitPrice, money } from "@/lib/channelBilling";
import { ensureClassicSettlementColumns } from "@/lib/schemaGuards";
import { deleteExhaustedChannelCampaignPosts, type CampaignPostDeletionSummary } from "@/lib/campaignPostDeletion";
import { markCampaignBudgetExhausted } from "@/lib/campaignLifecycle";
import { calculateCurrentCanonicalAllocation, shadowWriteChannelAllocation, unitsToDecimal } from "@/lib/channelAllocationLedger";
import { claimAdvertiserDirectDebit } from "@/lib/advertiserDirectDebit";
import { cleanupChannelDailyCapPosts, markChannelDailyCapReached } from "@/lib/channelDailyCap";
import { waivedViewsForPostSql } from "@/lib/channelViewWaivers";
import { withFinancialTransactionRetry } from "@/lib/dbResilience";
import { CHANNEL_DEBIT_SNAPSHOT_POLICY_VERSION, resolveDirectSplitFromStoredPolicy } from "@/lib/channelAllocationMath";
import { getChannelDailySpend } from "@/lib/channelDailySpend";
import { validateViewReserveEligibility } from "@/lib/channelTrustFraudStability";
import { computeNetQualifyingClicks, publisherHasCampaignQualifyingClicks } from "@/lib/channelCpcZeroClickEligibility";
import { CHANNEL_BILLABLE_CAMPAIGN_SQL, isBillablePublishedPlacement } from "@/lib/campaignCreativeRevision";
import { hasAcceptedPreCutoffClick } from "@/lib/channelAcceptedEngagement";
import { isEligibleChannelViewFetchSource, isEligibleChannelViewTrackingStatus } from "@/lib/channelViewPersistence";
import {
  isUnifiedSettlementActive,
  isUnifiedSchemaReady,
  STANDARD_CPC_CLICK_POLICY_VERSION,
  settleCanonicalCpcClick,
  settleCanonicalCpcZeroClickAdvance,
  settleCanonicalCpmViews,
} from "@/lib/channelUnifiedSettlement";
import { SMART_REACH_POLICY_VERSION } from "@/lib/channelSmartReachConfiguration";

type LockedPost = RowDataPacket & {
  campaign_kind: string;
  financial_policy_version: string | null;
  campaign_id: number; channel_id: number; publisher_id: number; advertiser_id: number; campaign_type: string;
  funding_model: "legacy_reserved" | "direct_debit";
  campaign_status: string; post_status: string; pause_reason: string | null;
  status_before_creative_review: string | null; approved_creative_revision_id: number | null;
  pending_creative_revision_id: number | null; deleted_at: Date | null;
  delivery_failed_at: Date | null; accepted_view_before_cutoff: number;
  budget: string | number; cpm: string | number; cpc: string | number; daily_budget_limit: string | number | null;
  advertiser_discount: string | number;
  views: string | number; settled_views: string | number; settled_clicks: string | number; waived_views: string | number;
  recorded_qualifying_clicks: number; fraud_excluded_clicks: number;
  view_fetch_status: string | null; view_fetch_source: string | null; delivery_confirmed_at: Date | null;
  channel_status: string; under_review: number; settlement_held: number; revenue_protection_status: string | null;
  view_tracking_status: string | null; subscriber_count: number;
};

async function lockedPost(conn: PoolConnection, postId: number) {
  // Lock campaign before post everywhere. Settlement writes campaigns before
  // inserting its post-referencing ledger row, so the inverse post→campaign
  // order here created a reproducible deadlock.
  const [identity] = await conn.query<Array<RowDataPacket & { campaign_id: number }>>(
    "SELECT campaign_id FROM campaign_posts WHERE id=? LIMIT 1",
    [postId],
  );
  if (!identity[0]) return null;
  await conn.query("SELECT id FROM campaigns WHERE id=? FOR UPDATE", [identity[0].campaign_id]);
  const [rows] = await conn.query<LockedPost[]>(`
    SELECT cp.campaign_id, cp.channel_id, cp.views, cp.settled_views, cp.settled_clicks,
      cp.view_fetch_status, cp.view_fetch_source, cp.delivery_confirmed_at,cp.delivery_failed_at,
      CASE WHEN cp.view_accepted_at IS NOT NULL AND cp.billing_cutoff_at IS NOT NULL
        AND cp.view_accepted_at<=cp.billing_cutoff_at THEN 1 ELSE 0 END accepted_view_before_cutoff,
      ${waivedViewsForPostSql("cp")} waived_views,
      (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id = cp.id AND cc.is_bot = 0) recorded_qualifying_clicks,
      COALESCE(cp.fraud_excluded_clicks, 0) fraud_excluded_clicks,
      c.type campaign_type, c.campaign_kind, c.financial_policy_version, c.status campaign_status, cp.status post_status,
      c.pause_reason,c.status_before_creative_review,c.approved_creative_revision_id,
      c.pending_creative_revision_id,cp.deleted_at,
      c.user_id advertiser_id, c.funding_model,
      c.budget, c.cpm, c.cpc, c.daily_budget_limit,
      CASE WHEN ard.expires_at > UTC_TIMESTAMP() THEN IF(c.type='clicks',ard.cpc_discount,ard.cpm_discount) ELSE 0 END advertiser_discount,
      ch.user_id publisher_id, ch.status channel_status, ch.under_review,
      CASE WHEN ch.settlement_excluded_until>UTC_TIMESTAMP() THEN 1 ELSE 0 END settlement_held,
      ch.revenue_protection_status, ch.view_tracking_status, ch.subscriber_count
    FROM campaign_posts cp JOIN campaigns c ON c.id=cp.campaign_id
    JOIN channels ch ON ch.id=cp.channel_id
    LEFT JOIN advertiser_rate_discounts ard ON ard.user_id=c.user_id
    WHERE cp.id=? FOR UPDATE`, [postId]);
  return rows[0] || null;
}

async function fastDebit(input: { conn: PoolConnection; postId: number; type: "click" | "view"; sourceKey: string; requestedUnits: number }) {
  const [existing] = await input.conn.query<RowDataPacket[]>("SELECT id FROM channel_advertiser_debits WHERE source_key=?", [input.sourceKey]);
  if (existing.length) return { debited: false, duplicate: true, units: 0, becameExhausted: false, dailyCapped: false, campaignId: null };
  const post = await lockedPost(input.conn, input.postId);
    const livePlacement = post && !post.delivery_failed_at && isBillablePublishedPlacement({
    campaignStatus: post.campaign_status, pauseReason: post.pause_reason,
    priorStatus: post.status_before_creative_review,
    approvedRevisionId: post.approved_creative_revision_id,
    pendingRevisionId: post.pending_creative_revision_id,
    placementStatus: post.post_status, deliveryConfirmed: Boolean(post.delivery_confirmed_at),
    deleted: Boolean(post.deleted_at),
  });
  const deletedDuringModeration = post && post.campaign_status === "paused" &&
    post.pause_reason === "moderation_cleanup" && Boolean(post.approved_creative_revision_id) &&
    Boolean(post.delivery_confirmed_at) && !post.delivery_failed_at && Boolean(post.deleted_at);
  const acceptedDeletedClick = Boolean(deletedDuringModeration && input.type === "click" &&
    await hasAcceptedPreCutoffClick(input.conn, {
      campaignId: post.campaign_id, postId: input.postId,
      clickId: Number(input.sourceKey.replace(/^click:/, "")),
    }));
  const acceptedDeletedView = Boolean(deletedDuringModeration && input.type === "view" &&
    post.campaign_type === "views" && Number(post.accepted_view_before_cutoff) === 1 &&
    input.requestedUnits <= Number(post.views));
  if (!post || post.campaign_kind === "channel_growth" ||
      (!livePlacement && !acceptedDeletedClick && !acceptedDeletedView) ||
      (input.type === "click" ? post.campaign_type !== "clicks" : post.campaign_type !== "views" && post.campaign_type !== "clicks")) {
    return { debited: false, duplicate: false, units: 0, becameExhausted: false, dailyCapped: false, campaignId: null };
  }
  // Smart Reach views have their own verified-impression billing route. Never
  // interpret them as Standard CPC zero-click advances or legacy reserve work.
  if (input.type === "view" && post.financial_policy_version === SMART_REACH_POLICY_VERSION)
    return { debited: false, duplicate: false, units: 0, becameExhausted: false, dailyCapped: false, campaignId: post.campaign_id };
  const unitPrice = getChannelUnitPrice({ type: post.campaign_type, cpm: post.cpm, cpc: post.cpc, discount: post.advertiser_discount });
  if (!(unitPrice > 0)) return { debited: false, duplicate: false, units: 0, becameExhausted: false, dailyCapped: false, campaignId: post.campaign_id };

  // A rollback cannot strand advances or reinterpret canonical debit history.
  if (!isUnifiedSettlementActive()) {
    if (!(await isUnifiedSchemaReady(input.conn))) throw new Error("channel_v101_history_safety_schema_unavailable");
    const [history] = await input.conn.query<RowDataPacket[]>(
      "SELECT id FROM channel_cpc_reserve_advances WHERE campaign_id=? LIMIT 1", [post.campaign_id]
    );
    const [events] = await input.conn.query<RowDataPacket[]>(
      "SELECT id FROM channel_unified_settlement_events WHERE campaign_id=? LIMIT 1", [post.campaign_id]
    );
    if (history.length || events.length) throw new Error("channel_v101_history_requires_unified_settlement");
  }
  // CPC impressions are reserve evaluations, never advertiser CPM billing.
  if (input.type === "view" && post.campaign_type === "clicks" && !isUnifiedSettlementActive()) {
    return { debited: false, duplicate: false, units: 0, becameExhausted: false, dailyCapped: false, campaignId: post.campaign_id };
  }
  if (isUnifiedSettlementActive()) {
    const schemaReady = await isUnifiedSchemaReady(input.conn);
    if (!schemaReady) throw new Error("channel_v101_schema_not_ready");
    {
      const [[settings]] = await input.conn.query<Array<RowDataPacket & { margin: string | null; reserve: string | null }>>(
        "SELECT MAX(CASE WHEN `key`='platform_margin_percent' THEN value END) margin, MAX(CASE WHEN `key`='safety_reserve_percent' THEN value END) reserve FROM settings WHERE `key` IN ('platform_margin_percent','safety_reserve_percent')"
      );
      if (settings?.margin == null || settings?.reserve == null || String(settings.margin).trim() === "" || String(settings.reserve).trim() === "") {
        throw new Error("v101_revenue_split_settings_unavailable");
      }
      const revenueSplit = resolveDirectSplitFromStoredPolicy(settings.margin, settings.reserve);
      if (input.type === "click") {
        const clickId = Number(input.sourceKey.replace(/^click:/, ""));
        const canonical = await settleCanonicalCpcClick(input.conn, {
          campaignId: post.campaign_id,
          postId: input.postId,
          channelId: post.channel_id,
          publisherId: post.publisher_id,
          advertiserId: post.advertiser_id,
          clickId,
          clickUnitPrice: unitPrice,
          revenueSplit,
        });
        if (canonical.status === "settled") {
          return { debited: true, duplicate: false, units: 1, becameExhausted: false, dailyCapped: false, campaignId: post.campaign_id,
            advertiserDebit: canonical.advertiserDebitDecimal, publisherCredit: canonical.publisherCreditDecimal,
            platformRevenue: canonical.platformRevenueDecimal, reserveAmount: canonical.reserveAllocationDecimal };
        }
        if (canonical.status === "duplicate") {
          return { debited: false, duplicate: true, units: 0, becameExhausted: false, dailyCapped: false, campaignId: post.campaign_id };
        }
        if (canonical.status === "budget_exhausted") {
          await markCampaignBudgetExhausted(post.campaign_id, input.conn);
          return { debited: false, duplicate: false, units: 0, becameExhausted: true, dailyCapped: false, campaignId: post.campaign_id };
        }
        return { debited: false, duplicate: false, units: 0, becameExhausted: false, dailyCapped: false, campaignId: post.campaign_id };
      } else if (input.type === "view") {
        if (post.campaign_type === "views") {
          const cpmResult = await settleCanonicalCpmViews(input.conn, {
            campaignId: post.campaign_id,
            postId: input.postId,
            channelId: post.channel_id,
            publisherId: post.publisher_id,
            advertiserId: post.advertiser_id,
            confirmedViews: input.requestedUnits,
            cpmRate: getChannelBidPerThousand({ type: post.campaign_type, cpm: post.cpm, discount: post.advertiser_discount }),
            revenueSplit,
          });
          if (cpmResult.status === "settled") {
            return { debited: true, duplicate: false, units: Number(input.requestedUnits), becameExhausted: false, dailyCapped: false, campaignId: post.campaign_id,
              advertiserDebit: cpmResult.advertiserDebitDecimal, publisherCredit: cpmResult.publisherCreditDecimal,
              platformRevenue: cpmResult.platformRevenueDecimal, reserveAmount: cpmResult.reserveAllocationDecimal };
          }
          if (cpmResult.status === "duplicate") {
            return { debited: false, duplicate: true, units: 0, becameExhausted: false, dailyCapped: false, campaignId: post.campaign_id };
          }
          if (cpmResult.status === "budget_exhausted") {
            await markCampaignBudgetExhausted(post.campaign_id, input.conn);
            return { debited: false, duplicate: false, units: 0, becameExhausted: true, dailyCapped: false, campaignId: post.campaign_id };
          }
          return { debited: false, duplicate: false, units: 0, becameExhausted: false, dailyCapped: false, campaignId: post.campaign_id };
        } else if (post.campaign_type === "clicks") {
          if (process.env.CHANNEL_V101_CPC_PRIORITY_PAYOUT_ENABLED === "true" &&
              post.financial_policy_version !== STANDARD_CPC_CLICK_POLICY_VERSION) {
            return { debited: false, duplicate: false, units: 0, becameExhausted: false, dailyCapped: false, campaignId: post.campaign_id };
          }
          const netClicks = computeNetQualifyingClicks(
            Number(post.settled_clicks || 0),
            Number(post.recorded_qualifying_clicks || 0),
            Number(post.fraud_excluded_clicks || 0)
          );
          if (netClicks > 0) {
            return { debited: false, duplicate: false, units: 0, becameExhausted: false, dailyCapped: false, campaignId: post.campaign_id };
          }
          if (await publisherHasCampaignQualifyingClicks(input.conn, post.campaign_id, post.publisher_id)) {
            return { debited: false, duplicate: false, units: 0, becameExhausted: false, dailyCapped: false, campaignId: post.campaign_id };
          }
          const eligibleViews = Math.max(0, Math.min(Number(post.views || 0), Math.floor(input.requestedUnits)) - Number(post.waived_views || 0));
          const traffic = validateViewReserveEligibility({
            views: eligibleViews, clicks: netClicks,
            subscriberCount: Number(post.subscriber_count || 0), channelStatus: post.channel_status,
          });
          const advanceResult = await settleCanonicalCpcZeroClickAdvance(input.conn, {
            campaignId: post.campaign_id,
            postId: input.postId,
            channelId: post.channel_id,
            publisherId: post.publisher_id,
            campaignType: "clicks",
            eligibleViews,
            validationResult: {
              eligible: traffic.isEligible &&
                post.channel_status === "active" && !post.under_review && !post.settlement_held &&
                post.revenue_protection_status !== "blocked" &&
                post.revenue_protection_status !== "confirmed_fraud" &&
                isEligibleChannelViewTrackingStatus(post.view_tracking_status) &&
                post.view_fetch_status === "success" &&
                isEligibleChannelViewFetchSource(post.view_fetch_source) &&
                post.delivery_confirmed_at != null && eligibleViews > 0 &&
                netClicks === 0 &&
                Number(post.views || 0) >= input.requestedUnits,
              reason: traffic.reasons[0] || "cpc_view_evidence_or_channel_state_not_eligible",
            },
          });
          const isFunded = advanceResult.status === "funded" || advanceResult.status === "partially_funded";
          return {
            debited: isFunded,
            duplicate: advanceResult.status === "already_funded",
            units: Number(input.requestedUnits),
            becameExhausted: false,
            dailyCapped: false,
            campaignId: post.campaign_id,
            advertiserDebit: "0.00000000", publisherCredit: advanceResult.fundingDeltaDecimal,
            platformRevenue: "0.00000000", reserveAmount: "0.00000000",
          };
        }
      }
    }
  }

  const todaySpend = await getChannelDailySpend(input.conn, post.campaign_id);
  const budget = Math.max(0, Number(post.budget || 0));
  const dailyCap = Number(post.daily_budget_limit || 0);
  const dailyRemaining = dailyCap > 0 ? Math.max(0, dailyCap - todaySpend) : Number.POSITIVE_INFINITY;
  const affordableUnits = Math.max(0, Math.floor((Math.min(budget, dailyRemaining) + 1e-10) / unitPrice));
  const alreadySettled = input.type === "click" ? Number(post.settled_clicks || 0) : Number(post.settled_views || 0) + Number(post.waived_views || 0);
  const confirmedUnits = input.type === "click"
    ? Number((await input.conn.query<Array<RowDataPacket & { count: number }>>("SELECT COUNT(*) count FROM campaign_clicks WHERE post_id=?", [input.postId]))[0][0]?.count || 0)
    : Number(post.views || 0);
  const unbilledUnits = Math.max(0, confirmedUnits - alreadySettled);
  const units = Math.min(Math.max(0, Math.floor(input.requestedUnits)), unbilledUnits, affordableUnits);
  if (!units) {
    const becameExhausted = budget + 1e-10 < unitPrice;
    const dailyCapped = dailyCap > 0 && dailyRemaining + 1e-10 < unitPrice;
    if (becameExhausted) {
      await markCampaignBudgetExhausted(post.campaign_id, input.conn);
    } else if (dailyCapped) {
      await markChannelDailyCapReached(input.conn, post.campaign_id);
    }
    return { debited: false, duplicate: false, units: 0, becameExhausted, dailyCapped, campaignId: post.campaign_id };
  }
  const debit = money(units * unitPrice);
  if (post.funding_model === "direct_debit") {
    const walletDebit = await claimAdvertiserDirectDebit(input.conn, {
      sourceKey: `channel:${input.sourceKey}`,
      advertiserId: post.advertiser_id,
      campaignId: post.campaign_id,
      campaignTable: "campaigns",
      billingType: input.type === "click" ? "channel_click" : "channel_view",
      amount: debit,
      description: `Channel ${input.type} charge ${input.sourceKey}`,
    });
    if (!walletDebit.ok) {
      if (walletDebit.duplicate) return { debited: false, duplicate: true, units: 0, becameExhausted: false, dailyCapped: false, campaignId: post.campaign_id };
      await input.conn.query(
        "UPDATE campaigns SET status='paused',pause_reason='insufficient_balance' WHERE id=? AND status='active'",
        [post.campaign_id],
      );
      return { debited: false, duplicate: false, units: 0, becameExhausted: false, dailyCapped: false, campaignId: post.campaign_id, insufficientBalance: true };
    }
  }
  const [campaignUpdate] = await input.conn.query<ResultSetHeader>(`
    UPDATE campaigns c SET c.budget=GREATEST(c.budget-?,0), c.channel_spend=c.channel_spend+?
     WHERE c.id=? AND ${CHANNEL_BILLABLE_CAMPAIGN_SQL} AND c.budget>=?`, [debit, debit, post.campaign_id, debit]);
  if (campaignUpdate.affectedRows !== 1) return { debited: false, duplicate: false, units: 0, becameExhausted: false, dailyCapped: false, campaignId: post.campaign_id };
  const [[policy]] = await input.conn.query<Array<RowDataPacket & { margin: string | null; reserve: string | null }>>(
    "SELECT MAX(CASE WHEN `key`='platform_margin_percent' THEN value END) margin, MAX(CASE WHEN `key`='safety_reserve_percent' THEN value END) reserve FROM settings WHERE `key` IN ('platform_margin_percent','safety_reserve_percent')"
  );
  const margin = Number(policy?.margin);
  const reserve = Number(policy?.reserve);
  if (policy?.margin == null || policy?.reserve == null || !Number.isFinite(margin) || !Number.isFinite(reserve)
    || margin < 0 || margin > 100 || reserve < 0 || reserve > 100) throw new Error("channel_allocation_policy_unavailable");
  await input.conn.query(
    `INSERT INTO channel_advertiser_debits
      (source_key,settlement_type,campaign_id,post_id,channel_id,publisher_id,units,unit_price,advertiser_debit,platform_margin_percent,safety_reserve_percent,allocation_policy_version)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [input.sourceKey, input.type, post.campaign_id, input.postId, post.channel_id, post.publisher_id, units, unitPrice, debit, policy.margin, policy.reserve, CHANNEL_DEBIT_SNAPSHOT_POLICY_VERSION]
  );
  const settledColumn = input.type === "click" ? "settled_clicks" : "settled_views";
  await input.conn.query(`UPDATE campaign_posts SET ${settledColumn}=${settledColumn}+?, spend=spend+? WHERE id=?`, [units, debit, input.postId]);
  const remaining = money(budget - debit);
  const becameExhausted = remaining <= 0 || remaining + 1e-10 < unitPrice;
  const dailyCapped = dailyCap > 0 && dailyRemaining - debit + 1e-10 < unitPrice;
  if (becameExhausted) {
    await markCampaignBudgetExhausted(post.campaign_id, input.conn);
  } else if (dailyCapped) {
    await markChannelDailyCapReached(input.conn, post.campaign_id);
  }
  return { debited: true, duplicate: false, units, becameExhausted, dailyCapped, campaignId: post.campaign_id };
}

async function cleanupAfterFastDebit(result: Awaited<ReturnType<typeof fastDebit>>) {
  let cleanup: CampaignPostDeletionSummary | null = null;
  let cleanupError: string | null = null;
  if (result.becameExhausted && result.campaignId !== null) {
    try {
      cleanup = await deleteExhaustedChannelCampaignPosts(result.campaignId);
    } catch (error) {
      cleanupError = error instanceof Error ? error.message : "channel_exhaustion_cleanup_failed";
      console.error("Post-commit channel exhaustion cleanup failed", {
        campaign_id: result.campaignId,
        error: cleanupError,
      });
    }
  }
  if (result.dailyCapped && result.campaignId !== null) {
    try {
      cleanup = await cleanupChannelDailyCapPosts(result.campaignId);
    } catch (error) {
      cleanupError = error instanceof Error ? error.message : "channel_daily_cap_cleanup_failed";
      console.error("Post-commit channel daily-cap cleanup failed", { campaign_id: result.campaignId, error: cleanupError });
    }
  }
  return { ...result, cleanup, cleanupError };
}

export async function debitChannelClick(postId: number, clickId: number) {
  const startedAt = Date.now();
  await ensureClassicSettlementColumns();
  const result = await withFinancialTransactionRetry(
    (conn) => fastDebit({ conn, postId, type: "click", sourceKey: `click:${clickId}`, requestedUnits: 1 }),
    { operation: "channel_click_debit" },
  );
  console.info("channel_click_billing", JSON.stringify({ post_id: postId, click_id: clickId, billing_result: result.debited ? "debited" : result.duplicate ? "duplicate" : "not_billable", elapsed_ms: Date.now() - startedAt }));
  return cleanupAfterFastDebit(result);
}

export async function debitConfirmedChannelViews(postId: number, confirmedViews: number) {
  await ensureClassicSettlementColumns();
  const result = await withFinancialTransactionRetry(
    (conn) => fastDebit({ conn, postId, type: "view", sourceKey: `view:${postId}:${confirmedViews}`, requestedUnits: confirmedViews }),
    { operation: "channel_view_debit" },
  );
  return cleanupAfterFastDebit(result);
}

export async function settlePendingChannelPublisherCredits(options: number | { limit?: number; campaignId?: number } = 50) {
  const limit = Math.min(5000, Math.max(1, typeof options === "number" ? options : (options.limit ?? 50)));
  const campaignId = typeof options === "number" ? undefined : options.campaignId;
  let settled = 0; let credited = 0; let candidates = 0; let failed = 0; let missingPolicy = 0; let batches = 0; let lastId = 0;
  while (candidates < limit) {
    const batchLimit = Math.min(100, limit - candidates);
    const filters = ["publisher_status='pending'", "id>?"];
    const params: Array<number> = [lastId];
    if (campaignId !== undefined) {
      filters.push("campaign_id=?");
      params.push(campaignId);
    }
    params.push(batchLimit);
    const [ids] = await pool.query<Array<RowDataPacket & { id: number }>>(
      `SELECT id FROM channel_advertiser_debits WHERE ${filters.join(" AND ")} ORDER BY id LIMIT ?`,
      params,
    );
    if (!ids.length) break;
    batches += 1;
    candidates += ids.length;
    lastId = Number(ids[ids.length - 1].id);
    for (const candidate of ids) {
    try {
      const publisherCredit = await withFinancialTransactionRetry(async (conn) => {
        const [rows] = await conn.query<Array<RowDataPacket & Record<string, unknown>>>(
        `SELECT d.*,c.user_id advertiser_id FROM channel_advertiser_debits d
         JOIN campaigns c ON c.id=d.campaign_id
         WHERE d.id=? AND d.publisher_status='pending' FOR UPDATE SKIP LOCKED`, [candidate.id]);
        const row = rows[0];
        if (!row) return null;
        const marginSnapshot = row.platform_margin_percent;
        const reserveSnapshot = row.safety_reserve_percent;
        if (row.allocation_policy_version !== CHANNEL_DEBIT_SNAPSHOT_POLICY_VERSION || marginSnapshot == null || reserveSnapshot == null) {
          missingPolicy += 1;
          return null;
        }
        const debit = Number(row.advertiser_debit || 0);
        const marginPercent = Number(marginSnapshot);
        const reservePercent = Number(reserveSnapshot);
        if (!Number.isFinite(marginPercent) || !Number.isFinite(reservePercent) || marginPercent < 0 || marginPercent > 100 || reservePercent < 0 || reservePercent > 100) throw new Error("invalid_channel_debit_policy_snapshot");
        const margin = marginPercent / 100;
        const reserve = reservePercent / 100;
        const quality = await getPublisherQuality(Number(row.channel_id), conn);
        const publisherCredit = money(debit * (1 - margin) * (1 - reserve) * quality.qualityWeight);
        const platformRevenue = money(debit * margin);
        const reserveAmount = money(debit - platformRevenue - publisherCredit);
        const safety = await recordPayoutSafetyCheck({
        settlementType: String(row.settlement_type) === "view" ? "view" : "click",
        campaignId: Number(row.campaign_id),
        publisherId: Number(row.publisher_id),
        advertiserPaid: debit,
        publisherShare: publisherCredit,
        platformShare: platformRevenue,
        reserveShare: reserveAmount,
        expectedPublisherShare: publisherCredit,
        expectedPlatformShare: platformRevenue,
        expectedReserveShare: reserveAmount,
        metadata: {
          source: "channel_fast_debit",
          debit_id: Number(row.id),
          post_id: Number(row.post_id),
          units: Number(row.units || 0),
          quality_weight: quality.qualityWeight,
        },
        }, conn);
        if (safety.status !== "passed") throw new Error("payout_safety_check_failed");
        if (!(await creditSettledPublisherBalance(conn, Number(row.publisher_id), publisherCredit, {
          sourceKey: `channel:debit:${row.id}:publisher`,
          sourceSystem: "channel_fast_billing",
          sourceRecordId: String(row.id),
          policyVersion: CHANNEL_DEBIT_SNAPSHOT_POLICY_VERSION,
        }))) throw new Error("publisher_credit_failed");
        await recordReferralCommission(conn, {
          monetizingUserId: Number(row.publisher_id),
          monetizedAmount: publisherCredit,
          productType: "channel",
          sourceEventKey: `channel:debit:${row.id}`,
          metadata: { debit_id: row.id, post_id: row.post_id, campaign_id: row.campaign_id },
        });
        const table = row.settlement_type === "view" ? "ad_settlements_views" : "ad_settlements";
        const metric = row.settlement_type === "view" ? "views_count" : "clicks_count";
        await conn.query(`INSERT INTO ${table} (post_id,campaign_id,advertiser_id,channel_id,publisher_id,${metric},advertiser_paid,publisher_reward,status) VALUES (?,?,?,?,?,?,?,?,?)`,
        [row.post_id,row.campaign_id,row.advertiser_id,row.channel_id,row.publisher_id,row.units,debit,publisherCredit,isZeroOrdinaryLockEnabled() ? "unlocked" : "locked"]);
        await conn.query("UPDATE campaign_posts SET publisher_earnings=publisher_earnings+?,platform_revenue=platform_revenue+?,reserve_amount=reserve_amount+? WHERE id=?", [publisherCredit,platformRevenue,reserveAmount,row.post_id]);
        await conn.query("UPDATE campaigns SET channel_publisher_earnings=channel_publisher_earnings+?,channel_platform_revenue=channel_platform_revenue+?,channel_reserve_amount=channel_reserve_amount+? WHERE id=?", [publisherCredit,platformRevenue,reserveAmount,row.campaign_id]);
        await conn.query("UPDATE channel_advertiser_debits SET publisher_status='settled',publisher_credit=?,publisher_settled_at=NOW() WHERE id=? AND publisher_status='pending'", [publisherCredit,row.id]);
        const canonical = calculateCurrentCanonicalAllocation({
          advertiserDebit: String(row.advertiser_debit), platformMarginPercent: String(marginSnapshot),
          safetyReservePercent: String(reserveSnapshot), qualityWeight: String(quality.qualityWeight),
        });
        await shadowWriteChannelAllocation(conn, {
          sourceKey: `fast:${row.source_key}`,
          sourceType: String(row.settlement_type) === "view" ? "view" : "click",
          sourceRecordId: Number(row.id), campaignId: Number(row.campaign_id), postId: Number(row.post_id),
          channelId: Number(row.channel_id), advertiserId: Number(row.advertiser_id), publisherId: Number(row.publisher_id),
          billableUnits: Number(row.units), unitPrice: String(row.unit_price), advertiserDebit: unitsToDecimal(canonical.debit),
          publisherAllocation: unitsToDecimal(canonical.publisher), platformAllocation: unitsToDecimal(canonical.platform),
          reserveAllocation: unitsToDecimal(canonical.reserve), qualityAdjustment: unitsToDecimal(canonical.qualityAdjustment),
          occurredAt: String(row.created_at), settledAt: new Date(),
        });
        return publisherCredit;
      }, { operation: "channel_pending_publisher_credit" });
      if (publisherCredit !== null) {
        settled += 1;
        credited += publisherCredit;
      }
    } catch (error) {
      failed += 1;
      console.error("Pending channel publisher settlement failed", { id: candidate.id, error });
    }
    }
    if (ids.length < batchLimit) break;
  }
  return { candidates, settled, failed, missingPolicy, batches, publisherCredited: money(credited), safetyLimitReached: candidates >= limit };
}
