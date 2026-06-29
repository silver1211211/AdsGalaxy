import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";
import { getCurrentPostingSlot } from "@/lib/postingTimes";
import {
  autoPauseChannel,
  checkChannelHealth,
  classifyTelegramSendFailure,
  ensureDefaultChannelDistribution,
  recordChannelPostFailure,
  recordChannelPostSuccess,
  markChannelHealthSuccess,
} from "@/lib/channelLifecycle";
import { ALL_CATEGORIES } from "@/lib/campaignCategories";
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

export const dynamic = 'force-dynamic';

interface CampaignRow {
  id: number;
  user_id: number;
  name: string;
  budget: string | number;
  cpm?: string | number;
  category: string;
  continents: string;
  parse_mode: string;
  type: string;
  link: string;
  button_text: string;
  message_text: string;
  image_url: string | null;
  quality_score?: number;
  advertiser_trust_level?: string;
  campaign_priority_score?: number;
  advertiser_performance_score?: number;
}

interface ChannelRow {
  id: number;
  user_id: number;
  chat_id: string;
  username: string;
  title?: string;
  categories: string | string[] | null;
  audience_continents: string | string[] | null;
  inventory_score?: number;
  inventory_rank?: string;
  inventory_override?: string;
  inventory_priority_multiplier?: string | number;
  created_at?: string | Date;
  scheduler_slot?: string | null;
  paused_reason?: string | null;
  suggested_fix?: string | null;
}

interface RecentPostRow {
  campaign_id: number;
  channel_id: number;
  created_at: string | Date;
  status: string;
  deleted_at?: string | Date | null;
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
    lastResult = await sendTelegramMessage(chatId, text, options);
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

function parseJsonArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);

  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function normalizeTarget(value: string) {
  return value.toLowerCase().replace(/[_\s-]+/g, "");
}

function campaignMatchesChannel(campaign: CampaignRow, channel: ChannelRow) {
  const categoryMatches = campaign.category === ALL_CATEGORIES
    || parseJsonArray(channel.categories).includes(campaign.category);

  if (!categoryMatches) return false;

  const campaignContinents = parseJsonArray(campaign.continents).map(normalizeTarget);
  const channelContinents = parseJsonArray(channel.audience_continents).map(normalizeTarget);

  return campaignContinents.includes("global")
    || channelContinents.includes("global")
    || campaignContinents.some((continent) => channelContinents.includes(continent));
}

function buildPostMaps(posts: RecentPostRow[], hasDeletedAtColumn: boolean) {
  const recent24h = new Set<string>();
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);

  for (const post of posts) {
    const key = `${post.campaign_id}:${post.channel_id}`;
    const createdAt = new Date(post.created_at).getTime();

    if (createdAt > cutoff) {
      recent24h.add(key);
    }
  }

  return { recent24h };
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
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  const lock = await acquireCronLock("process-ads", 1800);
  if (!lock) {
    return NextResponse.json({ success: false, message: "Channel posting cron is already running" }, { status: 409 });
  }

  try {
    const blocked = await requireAdServingAllowed();
    if (blocked) return blocked;

    const isDev = process.env.MODE === "DEV";
    const now = Date.now();
    const intervalMinutes = parseInt(process.env.CRON_POSTS_INTERVAL || "10");
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
    const currentSlot = getCurrentPostingSlot();
    const currentSlotTimeForDb = `${currentSlot.postingSlotTime}:00`;
    const currentSlotStart = `${currentSlot.postingSlotDate} ${currentSlotTimeForDb}`;
    const channelSlotLimit = Math.max(1, parseInt(process.env.CRON_CHANNEL_SLOT_LIMIT || "200"));
    const campaignLimit = Math.max(1, parseInt(process.env.CRON_CAMPAIGN_LIMIT || "200"));
    const distribution = schedulerSchema.hasChannelSchedulerSlot
      ? await ensureDefaultChannelDistribution()
      : null;

    if (!schedulerSchema.hasChannelSchedulerSlot && !schedulerSchema.hasChannelPostingTimes) {
      console.warn("channel scheduler columns are missing; process-ads is using legacy 6-hour channel cooldown fallback");
    }

    const trustMultipliers = await getAdvertiserTrustMultipliers();
    const deliverySettings = await getDeliveryOptimizationSettings();
    const [campaigns]: any = await pool.query(`
      SELECT c.*, COALESCE(u.advertiser_trust_level, 'new') as advertiser_trust_level
      FROM campaigns c
      JOIN users u ON c.user_id = u.id
      WHERE c.status = 'active' AND c.budget > 0 AND c.type != 'broadcast'
        AND (c.start_at IS NULL OR c.start_at <= NOW())
        AND (c.end_at IS NULL OR c.end_at >= NOW())
        AND COALESCE(u.advertiser_trust_level, 'new') != 'restricted'
      ORDER BY budget DESC
      LIMIT ?
    `, [campaignLimit]);

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
        cpmBid: campaign.cpm,
        historicalPerformance: 50,
        advertiserPerformance,
      });
      campaign.advertiser_performance_score = advertiserPerformance;
      campaign.campaign_priority_score = campaignPriority;
    }

    const timingConditions = schedulerSchema.hasChannelSchedulerSlot
      ? `
      AND c.scheduler_slot = ?
      AND NOT EXISTS (
        SELECT 1 FROM campaign_posts cp
        WHERE cp.channel_id = c.id
        ${schedulerSchema.hasPostPostingModeColumn ? "AND cp.posting_mode = 'scheduled'" : ""}
        ${schedulerSchema.hasPostSlotColumns
          ? "AND cp.posting_slot_date = ? AND cp.posting_slot_time = ?"
          : "AND cp.created_at >= ? AND cp.created_at < DATE_ADD(?, INTERVAL 30 MINUTE)"
        }
      )`
      : schedulerSchema.hasChannelPostingTimes
      ? `
      AND (
        (JSON_VALID(c.posting_times) AND JSON_CONTAINS(c.posting_times, JSON_QUOTE(?)))
        OR (
          c.posting_times IS NULL
          AND (
            (COALESCE(c.posts_per_day, 1) <= 1 AND ? = '12:00')
            OR (c.posts_per_day = 2 AND ? IN ('12:00', '18:00'))
            OR (c.posts_per_day >= 3 AND ? IN ('12:00', '18:00', '00:00'))
          )
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM campaign_posts cp
        WHERE cp.channel_id = c.id
        ${schedulerSchema.hasPostPostingModeColumn ? "AND cp.posting_mode = 'scheduled'" : ""}
        ${schedulerSchema.hasPostSlotColumns
          ? "AND cp.posting_slot_date = ? AND cp.posting_slot_time = ?"
          : "AND cp.created_at >= ? AND cp.created_at < DATE_ADD(?, INTERVAL 30 MINUTE)"
        }
      )`
      : `
      AND NOT EXISTS (
        SELECT 1 FROM campaign_posts cp
        WHERE cp.channel_id = c.id AND cp.created_at > NOW() - INTERVAL 6 HOUR
      )`;

    const timingParams = schedulerSchema.hasChannelSchedulerSlot
      ? [
          currentSlot.postingSlotTime,
          ...(schedulerSchema.hasPostSlotColumns
            ? [currentSlot.postingSlotDate, currentSlotTimeForDb]
            : [currentSlotStart, currentSlotStart])
        ]
      : schedulerSchema.hasChannelPostingTimes
      ? [
          currentSlot.postingSlotTime,
          currentSlot.postingSlotTime,
          currentSlot.postingSlotTime,
          currentSlot.postingSlotTime,
          ...(schedulerSchema.hasPostSlotColumns
            ? [currentSlot.postingSlotDate, currentSlotTimeForDb]
            : [currentSlotStart, currentSlotStart])
        ]
      : [];

    const [channelRows]: any = await pool.query(`
      SELECT c.*
      FROM channels c
      WHERE c.status = 'active' AND c.is_deleted = FALSE
      AND COALESCE(c.health_status, 'active') = 'active'
      AND (
        SELECT COUNT(*) FROM campaign_posts cp
        WHERE cp.channel_id = c.id AND cp.created_at > NOW() - INTERVAL 1 DAY
        ${schedulerSchema.hasPostPostingModeColumn ? "AND cp.posting_mode = 'scheduled'" : ""}
      ) < c.posts_per_day
      ${timingConditions}
      ORDER BY c.id ASC
      LIMIT ?
    `, [...timingParams, channelSlotLimit]);
    const assignedChannelsCount = channelRows.length;
    const averageCampaignPriority = campaigns.length > 0
      ? campaigns.reduce((sum: number, campaign: CampaignRow) => sum + Number(campaign.campaign_priority_score || 50), 0) / campaigns.length
      : 50;
    const channels = rankInventoryForDelivery(
      channelRows as Array<ChannelRow & Record<string, unknown>>,
      deliverySettings,
      averageCampaignPriority
    ) as ChannelRow[];

    if (campaigns.length === 0 || channels.length === 0) {
      console.info("process-ads allocation skipped", {
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
        skipped: campaigns.length === 0 ? "no_active_campaigns" : "no_due_channel_slots"
      });
    }

    const campaignIds = campaigns.map((campaign: CampaignRow) => campaign.id);
    const channelIds = channels.map((channel: ChannelRow) => channel.id);

    const [dailyRows]: any = await pool.query(`
      SELECT campaign_id, COUNT(*) as count
      FROM campaign_posts
      WHERE campaign_id IN (?) AND created_at > NOW() - INTERVAL 1 DAY
      GROUP BY campaign_id
    `, [campaignIds]);

    const dailyCounts = new Map<number, number>(
      dailyRows.map((row: any) => [Number(row.campaign_id), Number(row.count)])
    );

    const [recentPosts]: any = await pool.query(`
      SELECT campaign_id, channel_id, created_at, status${schedulerSchema.hasPostDeletedAtColumn ? ", deleted_at" : ""}
      FROM campaign_posts
      WHERE campaign_id IN (?) AND channel_id IN (?)
      AND created_at > NOW() - INTERVAL 24 HOUR
    `, [campaignIds, channelIds]);

    const postMaps = buildPostMaps(recentPosts, schedulerSchema.hasPostDeletedAtColumn);
    const placementCounts = new Map<number, number>();
    const campaignResults = new Map<number, any>();
    const skippedReasons: Record<string, number> = {};
    const results = [];
    const dominanceCap = getWindowDominanceCap(channels.length);
    let selectedPlacements = 0;
    let attemptedPosts = 0;
    let failedPosts = 0;
    let autoPausedChannels = 0;
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

    for (const channel of channels as ChannelRow[]) {
      const health = await checkChannelHealth({ id: channel.id, chat_id: channel.chat_id });
      if (!health.ok) {
        failedPosts++;
        incrementSkip(`health_${health.status}`);
        if (health.permanent) {
          autoPausedChannels++;
          await autoPauseChannel(channel.id, health);
        } else {
          await recordChannelPostFailure(channel.id, health.reason || "Temporary channel health failure");
        }
        continue;
      }
      await markChannelHealthSuccess(channel.id);

      const eligibleCampaigns = (campaigns as CampaignRow[]).filter((campaign) => {
        if (campaign.user_id === channel.user_id) {
          incrementSkip("same_owner");
          return false;
        }

        if (!campaignMatchesChannel(campaign, channel)) {
          incrementSkip("targeting_mismatch");
          return false;
        }

        const key = `${campaign.id}:${channel.id}`;
        if (postMaps.recent24h.has(key)) {
          incrementSkip("same_campaign_channel_24h");
          return false;
        }

        return true;
      });

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

      const scoredCampaigns = eligibleCampaigns
        .map((campaign) => ({
          campaign,
          score: calculateCampaignScore(campaign, {
            totalEligibleBudget,
            totalSuccessfulPlacementsToday: totalPlacementsToday,
            actualPlacementsToday: (dailyCounts.get(campaign.id) || 0) + (placementCounts.get(campaign.id) || 0),
            maxUnderDelivery,
            trustMultipliers,
            inventoryScore: Number(channel.inventory_score || 50)
          })
        }))
        .sort((a, b) => b.score.score - a.score.score);

      const dominanceEligible = eligibleCampaigns.length > 1
        ? scoredCampaigns.filter(({ campaign }) => (placementCounts.get(campaign.id) || 0) < dominanceCap)
        : scoredCampaigns;

      if (dominanceEligible.length === 0) {
        incrementSkip("dominance_cap");
        continue;
      }

      const selected = dominanceEligible[0];
      const campaign = selected.campaign;

      const insertColumns = ["campaign_id", "channel_id", "channel_username", "status", "delivery_attempted_at"];
      const insertParams = [campaign.id, channel.id, channel.username, "pending_delivery", new Date()];

      if (schedulerSchema.hasPostPostingModeColumn) {
        insertColumns.push("posting_mode");
        insertParams.push("scheduled");
      }

      if (schedulerSchema.hasPostSlotColumns) {
        insertColumns.push("posting_slot_date", "posting_slot_time");
        insertParams.push(currentSlot.postingSlotDate, currentSlotTimeForDb);
      }

      const insertPlaceholders = insertColumns.map(() => "?").join(", ");
      const conn = await pool.getConnection();
      let postId = 0;
      try {
        await conn.beginTransaction();
        const [insertPost]: any = await conn.query(
          `INSERT INTO campaign_posts (${insertColumns.join(", ")}) VALUES (${insertPlaceholders})`,
          insertParams
        );
        postId = Number(insertPost.insertId);
        await conn.commit();
      } catch (error) {
        await conn.rollback();
        conn.release();
        failedPosts++;
        incrementSkip("post_insert_failed");
        continue;
      }
      conn.release();

      const parseModeMap: any = { html: "HTML", markdown: "MarkdownV2", none: undefined };
      const parseMode = parseModeMap[campaign.parse_mode] || "HTML";
      const domain = process.env.DOMAIN;
      const host = domain ? `https://${domain}` : (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin);
      const buttonUrl = campaign.type === "clicks"
        ? `${host}/api/clicks/${campaign.id}/${postId}`
        : campaign.link;
      const botUsername = process.env.TELEGRAM_BOT_USERNAME || process.env.NEXT_PUBLIC_BOT_USERNAME || "Ads_Galaxy_bot";

      const replyMarkup = {
        inline_keyboard: [
          [{ text: campaign.button_text, url: buttonUrl }],
          [{ text: "Advertise with Ads galaxy", url: `https://t.me/${botUsername}?start=advertise` }]
        ]
      };

      attemptedPosts++;
      const result = await sendTelegramMessageWithRetries(channel.chat_id, campaign.message_text, {
        photo: campaign.image_url,
        parse_mode: parseMode,
        reply_markup: replyMarkup
      });

      if (result.ok) {
        const messageId = result.result.result.message_id;

        await pool.query(
          "UPDATE campaign_posts SET status = 'active', message_id = ?, delivery_confirmed_at = NOW(), delivery_failure_reason = NULL WHERE id = ? AND status = 'pending_delivery'",
          [messageId, postId]
        );
        await recordChannelPostSuccess(channel.id);

        selectedPlacements++;
        placementCounts.set(campaign.id, (placementCounts.get(campaign.id) || 0) + 1);
        const campaignInfo = campaignResults.get(campaign.id);
        campaignInfo.posts_created++;
        await recordDeliveryEvent(
          schedulerSchema.hasCampaignDeliveryEvents,
          campaign.id,
          channel.id,
          "selected",
          selected.score.score,
          `smart_allocation:${publicInventoryQuality(channel.inventory_score || 50)}`
        );
      } else {
        await pool.query(
          "UPDATE campaign_posts SET status = 'delivery_failed', delivery_failed_at = NOW(), delivery_failure_reason = ? WHERE id = ? AND status = 'pending_delivery'",
          [String(result.result?.description || "Telegram send failed").slice(0, 255), postId]
        );
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
          await recordChannelPostFailure(channel.id, result.result?.description || "Telegram send failed");
        }
        incrementSkip("telegram_send_failed");
        await recordDeliveryEvent(
          schedulerSchema.hasCampaignDeliveryEvents,
          campaign.id,
          channel.id,
          "send_failed",
          selected.score.score,
          result.result?.description || "Telegram send failed"
        );
      }
    }

    for (const campaignInfo of campaignResults.values()) {
      if (campaignInfo.posts_created > 0) {
        results.push(campaignInfo);
      }
    }

    console.info("process-ads allocation summary", {
      eligible_channels_count: channels.length,
      eligible_campaigns_count: campaigns.length,
      selected_placements_count: selectedPlacements,
      skipped_reason_counts: skippedReasons,
      campaign_placement_distribution: Object.fromEntries(placementCounts),
      dominance_cap_per_campaign: dominanceCap,
      channel_slot_limit: channelSlotLimit,
      campaign_limit: campaignLimit,
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
        JSON.stringify({ distribution, skipped_reason_counts: skippedReasons }),
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
        assigned_channels_count: assignedChannelsCount,
        eligible_channels_count: channels.length,
        eligible_campaigns_count: campaigns.length,
        campaign_placement_distribution: Object.fromEntries(placementCounts),
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
        eligible_channels_count: channels.length,
        eligible_campaigns_count: campaigns.length,
        selected_placements_count: selectedPlacements,
        skipped_reason_counts: skippedReasons,
        campaign_placement_distribution: Object.fromEntries(placementCounts),
        dominance_cap_per_campaign: dominanceCap
        ,
        delivery_mode: deliverySettings.mode,
        exploration_allocation_percent: deliverySettings.exploration_allocation_percent,
        assigned_channels_count: assignedChannelsCount,
        attempted_posts: attemptedPosts,
        failed_posts: failedPosts,
        auto_paused_channels: autoPausedChannels,
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
