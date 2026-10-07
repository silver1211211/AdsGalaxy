/* eslint-disable @typescript-eslint/no-explicit-any -- scheduler queries combine legacy campaign schemas */
import { NextRequest, NextResponse } from "next/server";
import { channelDailySpendSql } from "@/lib/channelDailySpend";
import { randomUUID } from "crypto";
import pool from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";
import { getCurrentPostingSlot } from "@/lib/postingTimes";
import {
  autoPauseChannel,
  classifyTelegramSendFailure,
  ensureDefaultChannelDistribution,
  recordChannelPostFailure,
  recordChannelPostSuccess,
} from "@/lib/channelLifecycle";
import { verifyTelegramChannelAccess } from "@/lib/telegramChannelAccess";
import { channelCampaignMatchesInventory } from "@/lib/channelAudience";
import { calculateCampaignScore, getWindowDominanceCap } from "@/lib/campaignPlacement";
import { getAdvertiserTrustMultipliers } from "@/lib/advertiserTrust";
import {
  calculateAdvertiserPerformanceScore,
  calculateCampaignPriorityScore,
  getDeliveryOptimizationSettings,
  publicInventoryQuality,
  rankInventoryForDelivery
} from "@/lib/inventoryOptimization";
import { createSystemLog, logStatus } from "@/lib/systemLogs";
import { requireAdServingAllowed, upsertAdminAlert } from "@/lib/productionSafety";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import { campaignExcludesChannel, loadCampaignExclusions } from "@/lib/campaignInventoryExclusions";
import { composeCampaignCreativeTelegramHtml } from "@/lib/campaignCreative";
import { getChannelUnitPrice, channelUnitPriceSql } from "@/lib/channelBilling";
import { createGrowthDeliveryInvite } from "@/lib/channelGrowthInvite";
import { ensureClassicSettlementColumns } from "@/lib/schemaGuards";
import { isChannelAllowedForCampaign, silverCampaignDeliverySql } from "@/lib/silverCampaignControl";
import {
  getChannelScheduleSlotOccupancies,
  releaseChannelScheduleSlotClaim,
  reserveChannelPlacement,
  trackedChannelCtaUrl,
  trackedGrowthCtaUrl,
} from "@/lib/channelDelivery";
import { channelSchedulerGraceMinutes, evaluateChannelPostingSlot } from "@/lib/channelScheduleSlots";
import { reconcileChannelDailyCapLifecycle } from "@/lib/channelDailyCap";
import { outstandingViewsSql } from "@/lib/channelViewWaivers";
import { checkChannelPlacementAffordability } from "@/lib/channelPlacementAffordability";
import {
  buildAllocationBidMaxima,
  deterministicAllocationTieBreaker,
  normalizedCampaignAllocationBid,
  rankEligibleCampaigns,
  successfulChannelPlacementSql,
  zeroDeliveryReason,
} from "@/lib/channelCampaignAllocator";

export const dynamic = 'force-dynamic';

interface CampaignRow {
  id: number;
  public_id?: number;
  user_id: number;
  name: string;
  budget: string | number;
  cpm?: string | number;
  cpc?: string | number;
  advertiser_discount?: string | number;
  advertiser_ad_balance?: string | number;
  funding_model?: "legacy_reserved" | "direct_debit";
  daily_budget_limit?: string | number | null;
  category: string;
  continents: string;
  parse_mode: string;
  type: string;
  campaign_kind?: string;
  cost_per_subscriber?: string | number | null;
  destination_chat_id?: string | number | null;
  destination_channel_id?: string | number | null;
  link: string;
  button_text: string;
  campaign_title?: string | null;
  message_text: string;
  image_url: string | null;
  quality_score?: number;
  advertiser_trust_level?: string;
  campaign_priority_score?: number;
  advertiser_performance_score?: number;
  original_budget?: string | number;
  pending_liability?: number;
  available_budget_for_placement?: number;
  is_prioritized?: number | boolean;
  created_at?: string | Date;
}

interface ChannelRow extends Record<string, unknown> {
  id: number;
  user_id: number;
  chat_id: string;
  username: string;
  invite_link_hash?: string | null;
  title?: string;
  categories: string | string[] | null;
  audience_continents: string | string[] | null;
  authoritative_country_code?: string | null;
  authoritative_language_code?: string | null;
  inventory_score?: number;
  inventory_rank?: string;
  inventory_override?: string;
  inventory_priority_multiplier?: string | number;
  created_at?: string | Date;
  scheduler_slot?: string | null;
  posting_times?: unknown;
  posts_per_day?: number | string | null;
  paused_reason?: string | null;
  suggested_fix?: string | null;
}

interface DueChannelRow extends ChannelRow {
  postingSlotDate: string;
  postingSlotTime: string;
  scheduledFor: Date;
  windowExpiresAt: Date;
}

interface RecentPostRow {
  campaign_id: number;
  channel_id: number;
  created_at: string | Date;
  status: string;
  deleted_at?: string | Date | null;
  delivery_confirmed_at?: string | Date | null;
  delivery_failed_at?: string | Date | null;
}

async function getPostingSchedulerSchema() {
  const [rows]: any = await pool.query(`
    SELECT TABLE_NAME, COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND (
        (TABLE_NAME = 'channels' AND COLUMN_NAME IN ('posting_times', 'scheduler_slot', 'last_successful_post_at', 'last_failure_at', 'failure_reason', 'paused_reason', 'suggested_fix'))
        OR (TABLE_NAME = 'campaign_posts' AND COLUMN_NAME IN ('posting_slot_date', 'posting_slot_time', 'deleted_at', 'posting_mode'))
        OR (TABLE_NAME = 'campaign_delivery_events')
      )
  `);

  const columns = new Set(rows.map((row: any) => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
  const tables = new Set(rows.map((row: any) => row.TABLE_NAME));

  return {
    hasChannelPostingTimes: columns.has("channels.posting_times"),
    hasChannelSchedulerSlot: columns.has("channels.scheduler_slot"),
    hasChannelLifecycleColumns: columns.has("channels.last_successful_post_at") && columns.has("channels.last_failure_at") && columns.has("channels.failure_reason"),
    hasPostSlotColumns: columns.has("campaign_posts.posting_slot_date") && columns.has("campaign_posts.posting_slot_time"),
    hasPostDeletedAtColumn: columns.has("campaign_posts.deleted_at"),
    hasPostPostingModeColumn: columns.has("campaign_posts.posting_mode"),
    hasCampaignDeliveryEvents: tables.has("campaign_delivery_events")
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendTelegramMessageWithRetries(chatId: string | number, text: string, options: any) {
  let lastResult: any = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      lastResult = await sendTelegramMessage(chatId, text, options);
    } catch (error: any) {
      lastResult = { ok: false, description: String(error?.message || "Telegram send threw an error") };
    }
    if (lastResult?.ok) {
      return { ok: true, result: lastResult, attempts: attempt };
    }

    const permanent = classifyTelegramSendFailure(lastResult?.description || "");
    if (permanent) {
      return { ok: false, result: lastResult, attempts: attempt, permanent };
    }

    if (attempt < 3) {
      await sleep(1000 * attempt);
    }
  }

  return { ok: false, result: lastResult, attempts: 3, permanent: null };
}

function buildPostMaps(posts: RecentPostRow[]) {
  const recent24h = new Set<string>();
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);

  for (const post of posts) {
    if (!post.delivery_confirmed_at || post.delivery_failed_at) continue;
    const key = `${post.campaign_id}:${post.channel_id}`;
    const createdAt = new Date(post.delivery_confirmed_at as string | Date).getTime();

    if (createdAt > cutoff) {
      recent24h.add(key);
    }
  }

  return { recent24h };
}

async function loadActiveCampaignRows(input: { now: Date; pageSize: number; maxScan: number }) {
  const [[maximum]]: any = await pool.query(
    "SELECT COALESCE(MAX(id),0) max_id FROM campaigns WHERE status='active' AND budget>0 AND type!='broadcast'",
  );
  const maxId = Math.max(0, Number(maximum?.max_id || 0));
  if (!maxId) return { rows: [] as CampaignRow[], scanned: 0 };

  const minuteBucket = Math.floor(input.now.getTime() / 60_000) >>> 0;
  const startAfter = (Math.imul(minuteBucket, 0x85ebca6b) >>> 0) % (maxId + 1);
  const rows: CampaignRow[] = [];
  let scanned = 0;
  const scanRange = async (initialCursor: number, upperBound: number | null) => {
    let cursor = initialCursor;
    while (scanned < input.maxScan) {
      const limit = Math.min(input.pageSize, input.maxScan - scanned);
      const upperSql = upperBound === null ? "" : "AND c.id<=?";
      const params = upperBound === null ? [cursor, limit] : [cursor, upperBound, limit];
      const [page]: any = await pool.query(`
        SELECT c.*, u.ad_balance advertiser_ad_balance, COALESCE(u.advertiser_trust_level, 'new') advertiser_trust_level,
          CASE WHEN ard.expires_at > UTC_TIMESTAMP() THEN IF(c.type='clicks',ard.cpc_discount,ard.cpm_discount) ELSE 0 END advertiser_discount
        FROM campaigns c
        JOIN users u ON c.user_id=u.id
        LEFT JOIN advertiser_rate_discounts ard ON ard.user_id=c.user_id
        WHERE c.status='active' AND c.budget>0 AND c.type!='broadcast' AND c.id>? ${upperSql}
          AND ${silverCampaignDeliverySql("c")}
          AND (c.start_at IS NULL OR c.start_at<=NOW())
          AND (c.end_at IS NULL OR c.end_at>=NOW())
          AND (
            c.daily_budget_limit IS NULL OR c.daily_budget_limit<=0 OR
            ${channelDailySpendSql()} < c.daily_budget_limit
          )
          AND COALESCE(u.advertiser_trust_level,'new')!='restricted'
        ORDER BY c.id ASC LIMIT ?
      `, params);
      if (!page.length) break;
      rows.push(...page);
      scanned += page.length;
      cursor = Number(page[page.length - 1].id);
      if (page.length < limit || (upperBound !== null && cursor >= upperBound)) break;
    }
  };

  await scanRange(startAfter, null);
  if (scanned < input.maxScan && startAfter > 0) await scanRange(0, startAfter);
  return { rows, scanned };
}

function schedulerFairnessKey(channelId: number, now: Date) {
  let value = (Number(channelId) ^ Math.floor(now.getTime() / 60_000)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return (value ^ (value >>> 16)) >>> 0;
}

async function loadDueChannelSlots(input: {
  now: Date;
  graceMinutes: number;
  pageSize: number;
  maxScan: number;
}) {
  const [[maximum]]: any = await pool.query(
    "SELECT COALESCE(MAX(id),0) max_id FROM channels WHERE status='active' AND is_deleted=FALSE",
  );
  const maxId = Math.max(0, Number(maximum?.max_id || 0));
  if (!maxId) return { due: [] as DueChannelRow[], scanned: 0, expired: 0, expiredSamples: [] as Array<Record<string, unknown>> };

  const minuteBucket = Math.floor(input.now.getTime() / 60_000) >>> 0;
  const startAfter = (Math.imul(minuteBucket, 0x9e3779b1) >>> 0) % (maxId + 1);
  const due: DueChannelRow[] = [];
  const expiredSamples: Array<Record<string, unknown>> = [];
  let scanned = 0;
  let expired = 0;

  const scanRange = async (initialCursor: number, upperBound: number | null) => {
    let cursor = initialCursor;
    while (scanned < input.maxScan) {
      const remaining = input.maxScan - scanned;
      const limit = Math.min(input.pageSize, remaining);
      const upperSql = upperBound === null ? "" : "AND c.id<=?";
      const params = upperBound === null ? [cursor, limit] : [cursor, upperBound, limit];
      const [rows]: any = await pool.query(`
        SELECT c.*,g.authoritative_country_code,g.authoritative_language_code
        FROM channels c LEFT JOIN channel_geo_classifications g ON g.channel_id=c.id
        WHERE c.status='active' AND c.is_deleted=FALSE AND c.id>? ${upperSql}
        ORDER BY c.id ASC LIMIT ?
      `, params);
      if (!rows.length) break;
      scanned += rows.length;
      cursor = Number(rows[rows.length - 1].id);
      for (const row of rows as ChannelRow[]) {
        const slot = evaluateChannelPostingSlot(row, input.now, input.graceMinutes);
        if (slot.due && slot.slotDate && slot.slotTime && slot.scheduledFor && slot.windowExpiresAt) {
          due.push({
            ...row,
            postingSlotDate: slot.slotDate,
            postingSlotTime: slot.slotTime,
            scheduledFor: slot.scheduledFor,
            windowExpiresAt: slot.windowExpiresAt,
          });
        } else if (slot.missed) {
          expired += 1;
          if (expiredSamples.length < 20) {
            expiredSamples.push({
              channel_id: row.id,
              scheduled_slot: slot.slotDate && slot.slotTime ? `${slot.slotDate} ${slot.slotTime}` : null,
              scheduler_time: input.now.toISOString(),
              reason: "missed_schedule_slot",
            });
          }
        }
      }
      if (rows.length < limit || (upperBound !== null && cursor >= upperBound)) break;
    }
  };

  await scanRange(startAfter, null);
  if (scanned < input.maxScan && startAfter > 0) await scanRange(0, startAfter);
  due.sort((left, right) => schedulerFairnessKey(left.id, input.now) - schedulerFairnessKey(right.id, input.now));
  return { due, scanned, expired, expiredSamples };
}

async function markScheduledPlacementFailed(input: {
  postId: number;
  claimId: number;
  channelId: number;
  slotDate: string;
  slotTime: string;
  reason: string;
}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [failed] = await conn.query<any>(
      "UPDATE campaign_posts SET status='delivery_failed',delivery_failed_at=NOW(),delivery_failure_reason=? WHERE id=? AND status='pending_delivery'",
      [input.reason.slice(0, 255), input.postId],
    );
    if (Number(failed?.affectedRows || 0) !== 1) {
      await conn.rollback();
      return false;
    }
    const released = await releaseChannelScheduleSlotClaim(conn, input);
    await conn.commit();
    return released;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function recordDeliveryEvent(
  enabled: boolean,
  campaignId: number,
  channelId: number,
  eventType: string,
  score: number | null,
  reason: string
) {
  if (!enabled) return;

  try {
    await pool.query(`
      INSERT INTO campaign_delivery_events (campaign_id, channel_id, event_type, score, reason, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `, [campaignId, channelId, eventType, score, reason]);
  } catch (error: any) {
    console.warn("Failed to record campaign delivery event", {
      campaign_id: campaignId,
      channel_id: channelId,
      event_type: eventType,
      error: error.message
    });
  }
}

export async function GET(req: NextRequest) {
  const runId = randomUUID();
  const runStartedAt = new Date();
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  const lock = await acquireCronLock("process-ads", 1800);
  if (!lock) {
    return NextResponse.json({ success: false, message: "Channel posting cron is already running" }, { status: 409 });
  }

  try {
    await ensureClassicSettlementColumns();
    const dailyCapLifecycle = await reconcileChannelDailyCapLifecycle();
    const blocked = await requireAdServingAllowed();
    if (blocked) return blocked;

    const isDev = process.env.MODE === "DEV";
    const now = Date.now();
    // Normal channel scheduling is intentionally evaluated every minute. The
    // legacy CRON_POSTS_INTERVAL (9/10 minutes in production) caused due slots
    // to drift and is no longer authoritative for this route.
    const intervalMinutes = Math.min(5, Math.max(1, Number.parseInt(process.env.CHANNEL_SCHEDULER_INTERVAL_MINUTES || "1", 10) || 1));
    const intervalMs = intervalMinutes * 60 * 1000;

    const [throttleResult]: any = await pool.query(
      `UPDATE settings
       SET value = ?
       WHERE \`key\` = 'last_cron_run'
         AND (CAST(value AS UNSIGNED) <= ? OR ? = 1)`,
      [now.toString(), String(now - intervalMs), isDev ? 1 : 0]
    );

    if (throttleResult.affectedRows !== 1) {
      const minutesLeft = intervalMinutes;
      return NextResponse.json({
        success: false,
        message: `Too early. Please wait ${minutesLeft} more minutes.`
      }, { status: 429 });
    }

    const schedulerSchema = await getPostingSchedulerSchema();
    const schedulerNow = new Date();
    const schedulerGraceMinutes = channelSchedulerGraceMinutes();
    const currentSlot = getCurrentPostingSlot();
    const currentSlotTimeForDb = `${currentSlot.postingSlotTime}:00`;
    const channelSlotLimit = Math.max(1, parseInt(process.env.CRON_CHANNEL_SLOT_LIMIT || "200"));
    const channelScanLimit = Math.max(channelSlotLimit, parseInt(process.env.CRON_CHANNEL_SCAN_LIMIT || "2000"));
    const campaignPageSize = Math.max(1, parseInt(process.env.CRON_CAMPAIGN_LIMIT || "200"));
    const campaignScanLimit = Math.max(campaignPageSize, parseInt(process.env.CRON_CAMPAIGN_SCAN_LIMIT || "2000"));
    const distribution = schedulerSchema.hasChannelSchedulerSlot
      ? await ensureDefaultChannelDistribution()
      : null;

    if (!schedulerSchema.hasChannelSchedulerSlot && !schedulerSchema.hasChannelPostingTimes) {
      console.warn("channel scheduler columns are missing; process-ads is using legacy 6-hour channel cooldown fallback");
    }

    const trustMultipliers = await getAdvertiserTrustMultipliers();
    const deliverySettings = await getDeliveryOptimizationSettings();
    const campaignScan = await loadActiveCampaignRows({
      now: schedulerNow,
      pageSize: campaignPageSize,
      maxScan: campaignScanLimit,
    });
    let campaigns = campaignScan.rows;
    const [silverExemptionRows]: any = campaigns.length ? await pool.query(
      `SELECT cai.campaign_id,seu.user_id FROM campaign_admin_isolation cai JOIN silver_ad_exempt_users seu ON seu.active=1 WHERE cai.management_scope='silver' AND cai.campaign_id IN (?)`,
      [campaigns.map((campaign) => campaign.id)]
    ) : [[]];
    const silverExemptPairs = new Set((silverExemptionRows as Array<{campaign_id:number;user_id:number}>).map((row) => `${Number(row.campaign_id)}:${Number(row.user_id)}`));
    const prioritizedCampaignCount = campaigns.filter((campaign) => Boolean(campaign.is_prioritized)).length;

    if (campaigns.length > 0) {
      const activePostDeleteFilter = schedulerSchema.hasPostDeletedAtColumn ? "AND cp.deleted_at IS NULL" : "";
      const [liabilityRows]: any = await pool.query(`
        SELECT
          c.id AS campaign_id,
          COALESCE(SUM(
            CASE
              WHEN c.type = 'views' THEN ${outstandingViewsSql("cp")}
              WHEN c.type = 'clicks' THEN GREATEST((SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id = cp.id) - COALESCE(cp.settled_clicks, 0), 0)
              ELSE 0
            END * (${channelUnitPriceSql("c", "CASE WHEN ard.expires_at>UTC_TIMESTAMP() THEN IF(c.type='clicks',ard.cpc_discount,ard.cpm_discount) ELSE 0 END", false)})
          ), 0) AS unsettled_liability,
          COALESCE(SUM(
            CASE
              WHEN (cp.status='pending_delivery' OR (c.type='views' AND cp.status IN ('active','posted','sent')))
                AND cp.delivery_failed_at IS NULL
                ${activePostDeleteFilter}
              THEN (${channelUnitPriceSql("c", "CASE WHEN ard.expires_at>UTC_TIMESTAMP() THEN IF(c.type='clicks',ard.cpc_discount,ard.cpm_discount) ELSE 0 END", false)})
              ELSE 0
            END
          ), 0) AS active_post_buffer,
          ${channelDailySpendSql()} AS today_spend
        FROM campaigns c
        LEFT JOIN campaign_posts cp ON cp.campaign_id = c.id
        LEFT JOIN advertiser_rate_discounts ard ON ard.user_id=c.user_id
        WHERE c.id IN (?)
        GROUP BY c.id
      `, [campaigns.map((campaign) => campaign.id)]);

      const liabilityByCampaign = new Map<number, { unsettled: number; buffer: number; todaySpend: number }>(
        liabilityRows.map((row: any) => [
          Number(row.campaign_id),
          {
            unsettled: Math.max(0, Number(row.unsettled_liability || 0)),
            buffer: Math.max(0, Number(row.active_post_buffer || 0)),
            todaySpend: Math.max(0, Number(row.today_spend || 0)),
          },
        ])
      );

      campaigns = campaigns
        .map((campaign) => {
          const liability = liabilityByCampaign.get(Number(campaign.id)) || { unsettled: 0, buffer: 0, todaySpend: 0 };
          const originalBudget = Number(campaign.budget || 0);
          // Growth posts do not spend on impressions; only a verified subscriber
          // conversion reserves/debits one CPS unit inside channelGrowth.ts.
          const pendingLiability = campaign.campaign_kind === "channel_growth"
            ? 0
            : Number((liability.unsettled + liability.buffer).toFixed(8));
          const dailyBudget = Number(campaign.daily_budget_limit || 0);
          const dailyAvailable = dailyBudget > 0 ? dailyBudget - liability.todaySpend - pendingLiability : Number.POSITIVE_INFINITY;
          const availableBudget = Number((Math.min(originalBudget - pendingLiability, dailyAvailable)).toFixed(8));
          return {
            ...campaign,
            original_budget: campaign.budget,
            pending_liability: pendingLiability,
            available_budget_for_placement: availableBudget,
            budget: availableBudget,
          };
        })
        .filter((campaign) => {
          const unitPrice = campaign.campaign_kind === "channel_growth" ? Number(campaign.cost_per_subscriber || 0) : getChannelUnitPrice({ type: campaign.type, cpm: campaign.cpm, cpc: campaign.cpc, discount: campaign.advertiser_discount });
          const walletCanPay = campaign.funding_model !== "direct_debit"
            || Number(campaign.advertiser_ad_balance || 0) - Number(campaign.pending_liability || 0) + 1e-10 >= unitPrice;
          return Number.isFinite(unitPrice) && unitPrice > 0 && walletCanPay
            && Number(campaign.available_budget_for_placement || 0) >= unitPrice;
        });
    }

    for (const campaign of campaigns as CampaignRow[]) {
      const trustMultiplier = (trustMultipliers as Record<string, number>)[String(campaign.advertiser_trust_level || "new").toLowerCase()] || 1;
      const advertiserPerformance = calculateAdvertiserPerformanceScore({
        trustLevel: campaign.advertiser_trust_level,
        campaignQuality: campaign.quality_score,
        spend: Number(campaign.budget || 0),
        approvedCampaigns: 1,
      });
      const campaignPriority = calculateCampaignPriorityScore({
        advertiserTrustMultiplier: trustMultiplier,
        campaignQuality: campaign.quality_score,
        cpmBid: campaign.campaign_kind === "channel_growth"
          ? campaign.cost_per_subscriber
          : campaign.type === "clicks" ? campaign.cpc : campaign.cpm,
        historicalPerformance: 50,
        advertiserPerformance,
      });
      campaign.advertiser_performance_score = advertiserPerformance;
      campaign.campaign_priority_score = campaignPriority;
    }

    const dueScan = await loadDueChannelSlots({
      now: schedulerNow,
      graceMinutes: schedulerGraceMinutes,
      pageSize: channelSlotLimit,
      maxScan: channelScanLimit,
    });
    if (dueScan.expiredSamples.length) {
      console.info("process-ads missed schedule slots", {
        run_id: runId,
        due_slots_expired: dueScan.expired,
        samples: dueScan.expiredSamples,
      });
    }

    const dueChannelIds = dueScan.due.map((channel) => channel.id);
    const [dailyUsageRows]: any = dueChannelIds.length ? await pool.query(`
      SELECT cp.channel_id,COUNT(*) successful_count
      FROM campaign_posts cp
      WHERE cp.channel_id IN (?)
        AND cp.created_at>=UTC_DATE() AND cp.created_at<DATE_ADD(UTC_DATE(),INTERVAL 1 DAY)
        AND cp.status IN ('active','posted','sent','replaced','deleted','already_missing')
        AND cp.status<>'replaced'
        AND cp.delivery_confirmed_at IS NOT NULL
        AND cp.delivery_failed_at IS NULL
      GROUP BY cp.channel_id
    `, [dueChannelIds]) : [[]];
    const successfulDailyUsage = new Map<number, number>(
      (dailyUsageRows as Array<{ channel_id: number; successful_count: number }>).map((row) => [Number(row.channel_id), Number(row.successful_count)]),
    );
    const capacityEligible = dueScan.due.filter((channel) => (
      (successfulDailyUsage.get(channel.id) || 0) < Math.max(1, Number(channel.posts_per_day || 1))
    ));
    const occupancy = await getChannelScheduleSlotOccupancies(pool, capacityEligible.map((channel) => ({
      channelId: channel.id,
      slotDate: channel.postingSlotDate,
      slotTime: `${channel.postingSlotTime}:00`,
    })));
    const channelRows = capacityEligible.filter((channel) => {
      const key = `${channel.id}:${channel.postingSlotDate}:${channel.postingSlotTime}`;
      return (occupancy.get(key) || "available") === "available";
    }).slice(0, channelSlotLimit);
    const assignedChannelsCount = channelRows.length;
    const averageCampaignPriority = campaigns.length > 0
      ? campaigns.reduce((sum: number, campaign: CampaignRow) => sum + Number(campaign.campaign_priority_score || 50), 0) / campaigns.length
      : 50;
    const channels = rankInventoryForDelivery(
      channelRows,
      deliverySettings,
      averageCampaignPriority
    );

    if (campaigns.length === 0 || channels.length === 0) {
      console.info("process-ads allocation skipped", {
        run_id: runId,
        started_at: runStartedAt.toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - runStartedAt.getTime(),
        scheduler_grace_minutes: schedulerGraceMinutes,
        due_slots_found: dueScan.due.length,
        due_slots_processed: 0,
        due_slots_expired: dueScan.expired,
        channels_scanned: dueScan.scanned,
        eligible_campaigns_count: campaigns.length,
        eligible_channels_count: channels.length
      });

      await createSystemLog({
        logType: "channel_posting",
        status: "success",
        title: "Channel posting run completed",
        summary: campaigns.length === 0 ? "No active channel campaigns were available." : "No due channel slots were available.",
        slotDate: currentSlot.postingSlotDate,
        slotTime: currentSlotTimeForDb,
        attemptedCount: 0,
        successCount: 0,
        failedCount: 0,
        skippedCount: 0,
        failureReasons: {},
        metadata: {
          run_id: runId,
          scheduler_grace_minutes: schedulerGraceMinutes,
          due_slots_found: dueScan.due.length,
          due_slots_processed: 0,
          due_slots_expired: dueScan.expired,
          channels_scanned: dueScan.scanned,
          eligible_campaigns_count: campaigns.length,
          eligible_channels_count: channels.length,
          skipped: campaigns.length === 0 ? "no_active_campaigns" : "no_due_channel_slots",
          distribution,
        },
      });

      return NextResponse.json({
        success: true,
        processed_campaigns: 0,
        posts_created: 0,
        details: [],
        skipped: campaigns.length === 0 ? "no_active_campaigns" : "no_due_channel_slots",
        allocation: {
          run_id: runId,
          duration_ms: Date.now() - runStartedAt.getTime(),
          scheduler_grace_minutes: schedulerGraceMinutes,
          due_slots_found: dueScan.due.length,
          due_slots_processed: 0,
          due_slots_expired: dueScan.expired,
          channels_scanned: dueScan.scanned,
        },
      });
    }

    const campaignIds = campaigns.map((campaign: CampaignRow) => campaign.id);
    const channelIds = channels.map((channel: ChannelRow) => channel.id);
    const channelExclusions = await loadCampaignExclusions(pool, "campaign", campaignIds, "channel");

    const [dailyRows]: any = await pool.query(`
      SELECT campaign_id, COUNT(*) as count
      FROM campaign_posts
      WHERE campaign_id IN (?)
        AND delivery_confirmed_at>=UTC_DATE() AND delivery_confirmed_at<DATE_ADD(UTC_DATE(),INTERVAL 1 DAY)
        AND ${successfulChannelPlacementSql("campaign_posts")}
      GROUP BY campaign_id
    `, [campaignIds]);

    const dailyCounts = new Map<number, number>(
      dailyRows.map((row: any) => [Number(row.campaign_id), Number(row.count)])
    );

    const [lifetimeRows]: any = await pool.query(`
      SELECT campaign_id, COUNT(*) count, MAX(delivery_confirmed_at) last_successful_placement_at
      FROM campaign_posts
      WHERE campaign_id IN (?) AND ${successfulChannelPlacementSql("campaign_posts")}
      GROUP BY campaign_id
    `, [campaignIds]);
    const lifetimeCounts = new Map<number, number>(
      lifetimeRows.map((row: any) => [Number(row.campaign_id), Number(row.count)])
    );
    const lastSuccessfulPlacementAt = new Map<number, string | Date | null>(
      lifetimeRows.map((row: any) => [Number(row.campaign_id), row.last_successful_placement_at || null])
    );

    const [recentPosts]: any = await pool.query(`
      SELECT campaign_id, channel_id, created_at, status, delivery_confirmed_at, delivery_failed_at${schedulerSchema.hasPostDeletedAtColumn ? ", deleted_at" : ""}
      FROM campaign_posts
      WHERE campaign_id IN (?) AND channel_id IN (?)
        AND delivery_confirmed_at > NOW() - INTERVAL 24 HOUR
        AND ${successfulChannelPlacementSql("campaign_posts")}
    `, [campaignIds, channelIds]);

    const postMaps = buildPostMaps(recentPosts);
    const placementCounts = new Map<number, number>();
    const compatibleChannelCounts = new Map<number, number>();
    const frequencyEligibleChannelCounts = new Map<number, number>();
    const candidateAttemptCounts = new Map<number, number>();
    const campaignResults = new Map<number, any>();
    const skippedReasons: Record<string, number> = {};
    const results = [];
    const dominanceCap = getWindowDominanceCap(channels.length);
    let selectedPlacements = 0;
    let attemptedPosts = 0;
    let failedPosts = 0;
    let autoPausedChannels = 0;
    let dueSlotsProcessed = 0;
    let slotClaimsCreated = 0;
    let slotClaimsReused = 0;
    let slotClaimsReleasedOnFailure = 0;
    let slotClaimConflicts = 0;
    let telegramAttempts = 0;
    let telegramSuccesses = 0;
    let telegramFailures = 0;
    let fairnessFloorSelections = 0;
    let preSendCandidateFallbacks = 0;
    let preSendCandidateFailures = 0;
    let candidatePairsEvaluated = 0;
    let targetingCompatiblePairs = 0;
    let frequencyEligiblePairs = 0;
    const allocationBidMaxima = buildAllocationBidMaxima(campaigns);
    const allocationSeed = `${schedulerNow.toISOString().slice(0, 16)}:${runId}`;
    const initialTotalPlacementsToday = Array.from(dailyCounts.values()).reduce((sum, count) => sum + count, 0);

    for (const campaign of campaigns as CampaignRow[]) {
      campaignResults.set(campaign.id, {
        id: campaign.id,
        name: campaign.name,
        budget: campaign.budget,
        posts_created: 0,
        status: "processed"
      });
    }

    const incrementSkip = (reason: string) => {
      skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
    };

    for (const channel of channels as DueChannelRow[]) {
      dueSlotsProcessed++;
      const health = await verifyTelegramChannelAccess({
        channelId: channel.id,
        chatId: channel.chat_id,
        username: channel.username,
        source: "process_ads",
        persist: true,
        autoPauseActive: true,
      });
      if (!health.ok) {
        failedPosts++;
        incrementSkip(`health_${health.state}`);
        if (health.permanent) autoPausedChannels++;
        continue;
      }

      const eligibleCampaigns: CampaignRow[] = [];
      for (const campaign of campaigns as CampaignRow[]) {
        candidatePairsEvaluated++;
        if (silverExemptPairs.has(`${campaign.id}:${channel.user_id}`)) {
          incrementSkip("silver_exempt_publisher");
          continue;
        }
        if (campaignExcludesChannel(channelExclusions, campaign.id, channel)) {
          incrementSkip("advertiser_excluded_channel");
          continue;
        }
        if (campaign.user_id === channel.user_id) {
          incrementSkip("same_owner");
          continue;
        }

        if (!channelCampaignMatchesInventory({
          campaignCategory: campaign.category,
          campaignAudience: campaign.continents,
          channelCategories: channel.categories,
          channelAudience: channel.audience_continents,
          campaignCountries: (campaign as any).countries,
          campaignLanguages: (campaign as any).languages,
          channelCountry: channel.authoritative_country_code,
          channelLanguage: channel.authoritative_language_code,
        })) {
          incrementSkip("targeting_mismatch");
          continue;
        }

        targetingCompatiblePairs++;
        compatibleChannelCounts.set(campaign.id, (compatibleChannelCounts.get(campaign.id) || 0) + 1);

        const key = `${campaign.id}:${channel.id}`;
        if (postMaps.recent24h.has(key)) {
          incrementSkip("same_campaign_channel_24h");
          continue;
        }
        frequencyEligiblePairs++;
        frequencyEligibleChannelCounts.set(campaign.id, (frequencyEligibleChannelCounts.get(campaign.id) || 0) + 1);
        eligibleCampaigns.push(campaign);
      }

      if (eligibleCampaigns.length === 0) {
        incrementSkip("no_campaign_for_channel");
        continue;
      }

      const totalEligibleBudget = eligibleCampaigns.reduce((sum, campaign) => sum + Math.max(0, Number(campaign.budget) || 0), 0);
      const totalPlacementsToday = initialTotalPlacementsToday + selectedPlacements;
      const underDeliveries = eligibleCampaigns.map((campaign) => {
        const budgetWeight = totalEligibleBudget > 0 ? (Number(campaign.budget) || 0) / totalEligibleBudget : 0;
        const actual = (dailyCounts.get(campaign.id) || 0) + (placementCounts.get(campaign.id) || 0);
        return Math.max(0, (budgetWeight * totalPlacementsToday) - actual);
      });
      const maxUnderDelivery = Math.max(0, ...underDeliveries);

      const scoredCampaigns = eligibleCampaigns.map((campaign) => {
        const scoreDetail = calculateCampaignScore(campaign, {
            totalEligibleBudget,
            totalSuccessfulPlacementsToday: totalPlacementsToday,
            actualPlacementsToday: (dailyCounts.get(campaign.id) || 0) + (placementCounts.get(campaign.id) || 0),
            maxUnderDelivery,
            trustMultipliers,
            inventoryScore: Number(channel.inventory_score || 50),
            normalizedAllocationBid: normalizedCampaignAllocationBid(campaign, allocationBidMaxima),
            randomization: deterministicAllocationTieBreaker(allocationSeed, channel.id, campaign.id),
        });
        return {
          campaign,
          score: scoreDetail.score,
          scoreDetail,
          successfulThisRun: placementCounts.get(campaign.id) || 0,
          lifetimeSuccessful: lifetimeCounts.get(campaign.id) || 0,
          lastSuccessfulPlacementAt: lastSuccessfulPlacementAt.get(campaign.id) || null,
        };
      });
      const ranking = rankEligibleCampaigns({
        candidates: scoredCampaigns,
        dominanceCap,
        channelId: channel.id,
        seed: allocationSeed,
      });
      if (ranking.fairnessFloorApplied) fairnessFloorSelections++;

      if (ranking.ranked.length === 0) {
        incrementSkip("dominance_cap");
        continue;
      }

      let selected: (typeof ranking.ranked)[number] | null = null;
      let campaign: CampaignRow | null = null;
      let postId = 0;
      let slotClaimId = 0;
      for (const candidate of ranking.ranked) {
        campaign = candidate.campaign;
        candidateAttemptCounts.set(campaign.id, (candidateAttemptCounts.get(campaign.id) || 0) + 1);
        let finalSilverEligibility: Awaited<ReturnType<typeof isChannelAllowedForCampaign>>;
        try {
          finalSilverEligibility = await isChannelAllowedForCampaign(Number(campaign.id), Number(channel.id));
        } catch {
          incrementSkip("pre_send_eligibility_check_failed");
          preSendCandidateFailures++;
          preSendCandidateFallbacks++;
          continue;
        }
        if (!finalSilverEligibility.allowed) {
          incrementSkip(finalSilverEligibility.reason || "silver_delivery_blocked");
          preSendCandidateFallbacks++;
          continue;
        }

        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          const affordability = await checkChannelPlacementAffordability(conn, Number(campaign.id));
          if (!affordability.allowed) {
            await conn.rollback();
            incrementSkip(affordability.reason === "daily_cap_reached" ? "daily_budget_limit" : "budget_liability_limit");
            preSendCandidateFallbacks++;
            continue;
          }
          const generation = affordability.generation;
          const reservation = await reserveChannelPlacement(conn, {
            campaignId:Number(campaign.id),channelId:Number(channel.id),channelUsername:channel.username,
            generation,mode:"scheduled",
            postingSlotDate:schedulerSchema.hasPostSlotColumns?channel.postingSlotDate:undefined,
            postingSlotTime:schedulerSchema.hasPostSlotColumns?`${channel.postingSlotTime}:00`:undefined,
            capacityLimit:Math.max(1,Number(channel.posts_per_day || 1)),
          });
          if (!reservation.claimed) {
            await conn.rollback();
            incrementSkip(reservation.reason || "delivery_claim_exists");
            if (reservation.reason === "schedule_slot_claim_exists") {
              slotClaimConflicts++;
              break;
            }
            preSendCandidateFallbacks++;
            continue;
          }
          postId = reservation.postId;
          slotClaimId = Number(reservation.slotClaimId || 0);
          if (reservation.slotClaimCreated) slotClaimsCreated++;
          if (reservation.slotClaimReused) slotClaimsReused++;
          await conn.commit();
          selected = candidate;
          break;
        } catch {
          await conn.rollback().catch(() => undefined);
          incrementSkip("post_insert_failed");
          preSendCandidateFailures++;
          preSendCandidateFallbacks++;
        } finally {
          conn.release();
        }
      }
      if (!selected || !campaign) {
        failedPosts++;
        continue;
      }

      const domain = process.env.DOMAIN;
      const host = domain ? `https://${domain}` : (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin);
      let buttonUrl = trackedChannelCtaUrl(host,Number(campaign.public_id||campaign.id),postId);
      if (campaign.campaign_kind === "channel_growth") {
        try {
          await createGrowthDeliveryInvite({ campaignId: Number(campaign.id), postId, sourceChannelId: Number(channel.id), sourcePublisherId: Number(channel.user_id), destinationChatId: Number(campaign.destination_chat_id), destinationChannelId: campaign.destination_channel_id ? Number(campaign.destination_channel_id) : null });
          buttonUrl = trackedGrowthCtaUrl(host, Number(campaign.public_id || campaign.id), postId);
        } catch {
          if (slotClaimId) {
            const released = await markScheduledPlacementFailed({
              postId, claimId: slotClaimId, channelId: channel.id,
              slotDate: channel.postingSlotDate, slotTime: `${channel.postingSlotTime}:00`,
              reason: "growth_invite_unavailable",
            });
            if (released) slotClaimsReleasedOnFailure++;
          }
          failedPosts++; incrementSkip("growth_invite_unavailable"); continue;
        }
      }
      const botUsername = process.env.TELEGRAM_BOT_USERNAME || process.env.NEXT_PUBLIC_BOT_USERNAME || "Ads_Galaxy_bot";

      const replyMarkup = {
        inline_keyboard: [
          [{ text: campaign.button_text, url: buttonUrl }],
          [{ text: "Advertise with Ads galaxy", url: `https://t.me/${botUsername}?start=advertise` }]
        ]
      };

      attemptedPosts++;
      telegramAttempts++;
      const result = await sendTelegramMessageWithRetries(channel.chat_id, composeCampaignCreativeTelegramHtml(campaign.campaign_title, campaign.message_text), {
        photo: campaign.image_url,
        parse_mode: "HTML",
        reply_markup: replyMarkup
      });

      if (result.ok) {
        telegramSuccesses++;
        const messageId = result.result.result.message_id;

        const [confirmed]: any = await pool.query(
          "UPDATE campaign_posts SET status = 'active', message_id = ?, delivery_confirmed_at = NOW(), delivery_failure_reason = NULL WHERE id = ? AND status = 'pending_delivery'",
          [messageId, postId]
        );
        if (Number(confirmed?.affectedRows || 0) !== 1) {
          failedPosts++;
          incrementSkip("delivery_confirmation_not_persisted");
          continue;
        }
        await recordChannelPostSuccess(channel.id);
        console.info("process-ads scheduled placement delivered", {
          run_id: runId,
          channel_id: channel.id,
          campaign_id: campaign.id,
          configured_slot: `${channel.postingSlotDate} ${channel.postingSlotTime}`,
          actual_delivery_time: new Date().toISOString(),
          delivery_delay_seconds: Math.max(0, Math.floor((Date.now() - channel.scheduledFor.getTime()) / 1000)),
        });

        selectedPlacements++;
        placementCounts.set(campaign.id, (placementCounts.get(campaign.id) || 0) + 1);
        postMaps.recent24h.add(`${campaign.id}:${channel.id}`);
        lastSuccessfulPlacementAt.set(campaign.id, new Date());
        const campaignInfo = campaignResults.get(campaign.id);
        campaignInfo.posts_created++;
        await recordDeliveryEvent(
          schedulerSchema.hasCampaignDeliveryEvents,
          campaign.id,
          channel.id,
          "selected",
          selected.score,
          `smart_allocation:${publicInventoryQuality(channel.inventory_score || 50)}`
        );
      } else {
        telegramFailures++;
        const failureReason = String(result.result?.description || "Telegram send failed").slice(0, 255);
        if (slotClaimId) {
          const released = await markScheduledPlacementFailed({
            postId, claimId: slotClaimId, channelId: channel.id,
            slotDate: channel.postingSlotDate, slotTime: `${channel.postingSlotTime}:00`,
            reason: failureReason,
          });
          if (released) slotClaimsReleasedOnFailure++;
        }
        failedPosts++;
        if (result.permanent) {
          autoPausedChannels++;
          await autoPauseChannel(channel.id, {
            ok: false,
            status: result.permanent.status,
            reason: result.permanent.reason,
            suggestedFix: result.permanent.suggestedFix,
            permanent: true,
          });
        } else {
          await recordChannelPostFailure(channel.id, failureReason);
        }
        incrementSkip("telegram_send_failed");
        await recordDeliveryEvent(
          schedulerSchema.hasCampaignDeliveryEvents,
          campaign.id,
          channel.id,
          "send_failed",
          selected.score,
          failureReason
        );
      }
    }

    for (const campaignInfo of campaignResults.values()) {
      if (campaignInfo.posts_created > 0) {
        results.push(campaignInfo);
      }
    }

    const campaignAllocationDiagnostics = campaigns.slice(0, 100).map((campaign) => {
      const successfulThisRun = placementCounts.get(campaign.id) || 0;
      const compatibleChannels = compatibleChannelCounts.get(campaign.id) || 0;
      const frequencyEligibleChannels = frequencyEligibleChannelCounts.get(campaign.id) || 0;
      const candidateAttempts = candidateAttemptCounts.get(campaign.id) || 0;
      return {
        campaign_id: campaign.id,
        public_id: campaign.public_id || null,
        pricing_bucket: campaign.campaign_kind === "channel_growth" ? "cps" : campaign.type === "clicks" ? "cpc" : "cpm",
        prioritized: Boolean(campaign.is_prioritized),
        global_eligible: true,
        compatible_channels: compatibleChannels,
        frequency_eligible_channels: frequencyEligibleChannels,
        successful_this_run: successfulThisRun,
        lifetime_successful: lifetimeCounts.get(campaign.id) || 0,
        last_successful_placement_at: lastSuccessfulPlacementAt.get(campaign.id) || null,
        candidate_attempts: candidateAttempts,
        zero_delivery_reason: zeroDeliveryReason({
          successfulThisRun,
          compatibleChannels,
          frequencyEligibleChannels,
          candidateAttempts,
        }),
      };
    });
    const allocationFunnel = {
      global_eligible_campaigns: campaigns.length,
      prioritized_campaigns: prioritizedCampaignCount,
      campaign_pairs_evaluated: candidatePairsEvaluated,
      targeting_compatible_pairs: targetingCompatiblePairs,
      frequency_eligible_pairs: frequencyEligiblePairs,
      fairness_floor_selections: fairnessFloorSelections,
      pre_send_candidate_failures: preSendCandidateFailures,
      pre_send_candidate_fallbacks: preSendCandidateFallbacks,
      successful_placements: selectedPlacements,
    };

    console.info("process-ads allocation summary", {
      run_id: runId,
      started_at: runStartedAt.toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - runStartedAt.getTime(),
      due_slots_found: dueScan.due.length,
      due_slots_processed: dueSlotsProcessed,
      due_slots_success: selectedPlacements,
      due_slots_failed: failedPosts,
      due_slots_claim_conflict: slotClaimConflicts,
      due_slots_expired: dueScan.expired,
      due_slots_skipped_health: Object.entries(skippedReasons).filter(([key]) => key.startsWith("health_")).reduce((sum, [, value]) => sum + value, 0),
      due_slots_skipped_no_campaign: skippedReasons.no_campaign_for_channel || 0,
      slot_claims_created: slotClaimsCreated,
      slot_claims_reused: slotClaimsReused,
      slot_claims_released_on_failure: slotClaimsReleasedOnFailure,
      telegram_attempts: telegramAttempts,
      telegram_successes: telegramSuccesses,
      telegram_failures: telegramFailures,
      channels_scanned: dueScan.scanned,
      eligible_channels_count: channels.length,
      eligible_campaigns_count: campaigns.length,
      campaigns_scanned: campaignScan.scanned,
      selected_placements_count: selectedPlacements,
      skipped_reason_counts: skippedReasons,
      campaign_placement_distribution: Object.fromEntries(placementCounts),
      dominance_cap_per_campaign: dominanceCap,
      channel_slot_limit: channelSlotLimit,
      campaign_page_size: campaignPageSize,
      campaign_scan_limit: campaignScanLimit,
      campaign_diagnostics_truncated: campaigns.length > campaignAllocationDiagnostics.length,
      allocation_funnel: allocationFunnel,
      campaign_allocation_diagnostics: campaignAllocationDiagnostics,
      attempted_posts: attemptedPosts,
      failed_posts: failedPosts,
      auto_paused_channels: autoPausedChannels,
      distribution
    });

    await pool.query(
      `INSERT INTO channel_scheduler_runs
        (slot_date, slot_time, assigned_channels, attempted, successful, failed, auto_paused, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        currentSlot.postingSlotDate,
        currentSlotTimeForDb,
        assignedChannelsCount,
        attemptedPosts,
        selectedPlacements,
        failedPosts,
        autoPausedChannels,
        JSON.stringify({
          run_id: runId,
          distribution,
          skipped_reason_counts: skippedReasons,
          scheduler_grace_minutes: schedulerGraceMinutes,
          due_slots_found: dueScan.due.length,
          due_slots_processed: dueSlotsProcessed,
          due_slots_expired: dueScan.expired,
          slot_claims_created: slotClaimsCreated,
          slot_claims_reused: slotClaimsReused,
          slot_claims_released_on_failure: slotClaimsReleasedOnFailure,
          telegram_attempts: telegramAttempts,
          telegram_successes: telegramSuccesses,
          telegram_failures: telegramFailures,
        }),
      ]
    ).catch(() => undefined);

    const skippedChannels = Object.values(skippedReasons).reduce((sum, value) => sum + Number(value || 0), 0);
    await createSystemLog({
      logType: "channel_posting",
      status: logStatus(selectedPlacements, failedPosts),
      title: "Channel posting run completed",
      summary: `Posting slot ${currentSlot.postingSlotTime} attempted ${attemptedPosts} channels with ${selectedPlacements} successful posts.`,
      slotDate: currentSlot.postingSlotDate,
      slotTime: currentSlotTimeForDb,
      attemptedCount: attemptedPosts,
      successCount: selectedPlacements,
      failedCount: failedPosts,
      skippedCount: skippedChannels,
      autoPausedCount: autoPausedChannels,
      failureReasons: skippedReasons,
      metadata: {
        run_id: runId,
        scheduler_grace_minutes: schedulerGraceMinutes,
        due_slots_found: dueScan.due.length,
        due_slots_processed: dueSlotsProcessed,
        due_slots_expired: dueScan.expired,
        slot_claims_created: slotClaimsCreated,
        slot_claims_reused: slotClaimsReused,
        slot_claims_released_on_failure: slotClaimsReleasedOnFailure,
        telegram_attempts: telegramAttempts,
        telegram_successes: telegramSuccesses,
        telegram_failures: telegramFailures,
        assigned_channels_count: assignedChannelsCount,
        eligible_channels_count: channels.length,
        eligible_campaigns_count: campaigns.length,
        campaigns_scanned: campaignScan.scanned,
        campaign_placement_distribution: Object.fromEntries(placementCounts),
        allocation_funnel: allocationFunnel,
        campaign_allocation_diagnostics: campaignAllocationDiagnostics,
        campaign_diagnostics_truncated: campaigns.length > campaignAllocationDiagnostics.length,
        dominance_cap_per_campaign: dominanceCap,
        delivery_mode: deliverySettings.mode,
        distribution,
      },
    });

    return NextResponse.json({
      success: true,
      processed_campaigns: results.length,
      posts_created: selectedPlacements,
      details: results,
      allocation: {
        run_id: runId,
        duration_ms: Date.now() - runStartedAt.getTime(),
        scheduler_grace_minutes: schedulerGraceMinutes,
        due_slots_found: dueScan.due.length,
        due_slots_processed: dueSlotsProcessed,
        due_slots_expired: dueScan.expired,
        slot_claims_created: slotClaimsCreated,
        slot_claims_reused: slotClaimsReused,
        slot_claims_released_on_failure: slotClaimsReleasedOnFailure,
        telegram_attempts: telegramAttempts,
        telegram_successes: telegramSuccesses,
        telegram_failures: telegramFailures,
        eligible_channels_count: channels.length,
        eligible_campaigns_count: campaigns.length,
        campaigns_scanned: campaignScan.scanned,
        selected_placements_count: selectedPlacements,
        skipped_reason_counts: skippedReasons,
        campaign_placement_distribution: Object.fromEntries(placementCounts),
        allocation_funnel: allocationFunnel,
        campaign_allocation_diagnostics: campaignAllocationDiagnostics,
        campaign_diagnostics_truncated: campaigns.length > campaignAllocationDiagnostics.length,
        dominance_cap_per_campaign: dominanceCap
        ,
        delivery_mode: deliverySettings.mode,
        exploration_allocation_percent: deliverySettings.exploration_allocation_percent,
        assigned_channels_count: assignedChannelsCount,
        attempted_posts: attemptedPosts,
        failed_posts: failedPosts,
        auto_paused_channels: autoPausedChannels,
        daily_cap_lifecycle: dailyCapLifecycle,
        distribution
      }
    });
  } catch (error: any) {
    console.error("Cron Processing Error:", error);
    await upsertAdminAlert({
      alertType: "channel_posting_failed",
      severity: "high",
      title: "Channel posting failed",
      details: error?.message || "Channel posting cron failed.",
      metadata: { route: "/api/cron/process-ads" },
    });
    await createSystemLog({
      logType: "system_error",
      status: "failed",
      title: "Channel posting cron failed",
      summary: error?.message || "Channel posting cron failed.",
      failedCount: 1,
      failureReasons: { system_error: 1 },
      metadata: { route: "/api/cron/process-ads" },
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
