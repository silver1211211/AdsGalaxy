import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";
import { getCurrentPostingSlot } from "@/lib/postingTimes";
import { ALL_CATEGORIES } from "@/lib/campaignCategories";
import { calculateCampaignScore, getWindowDominanceCap } from "@/lib/campaignPlacement";

export const dynamic = 'force-dynamic';

const ACTIVE_POST_STATUSES = new Set(["active", "posted", "sent"]);

interface CampaignRow {
  id: number;
  user_id: number;
  name: string;
  budget: string | number;
  category: string;
  continents: string;
  parse_mode: string;
  type: string;
  link: string;
  button_text: string;
  message_text: string;
  image_url: string | null;
}

interface ChannelRow {
  id: number;
  user_id: number;
  chat_id: string;
  username: string;
  title?: string;
  categories: string | string[] | null;
  audience_continents: string | string[] | null;
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
        (TABLE_NAME = 'channels' AND COLUMN_NAME = 'posting_times')
        OR (TABLE_NAME = 'campaign_posts' AND COLUMN_NAME IN ('posting_slot_date', 'posting_slot_time', 'deleted_at'))
        OR (TABLE_NAME = 'campaign_delivery_events')
      )
  `);

  const columns = new Set(rows.map((row: any) => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
  const tables = new Set(rows.map((row: any) => row.TABLE_NAME));

  return {
    hasChannelPostingTimes: columns.has("channels.posting_times"),
    hasPostSlotColumns: columns.has("campaign_posts.posting_slot_date") && columns.has("campaign_posts.posting_slot_time"),
    hasPostDeletedAtColumn: columns.has("campaign_posts.deleted_at"),
    hasCampaignDeliveryEvents: tables.has("campaign_delivery_events")
  };
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
  const activeUndeleted = new Set<string>();
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);

  for (const post of posts) {
    const key = `${post.campaign_id}:${post.channel_id}`;
    const createdAt = new Date(post.created_at).getTime();

    if (createdAt > cutoff) {
      recent24h.add(key);
    }

    const isActiveStatus = ACTIVE_POST_STATUSES.has(post.status);
    const isUndeleted = hasDeletedAtColumn ? !post.deleted_at : true;

    if (isActiveStatus && isUndeleted) {
      activeUndeleted.add(key);
    }
  }

  return { recent24h, activeUndeleted };
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
  try {
    const isDev = process.env.MODE === "DEV";
    const [settings]: any = await pool.query("SELECT value FROM settings WHERE `key` = 'last_cron_run'");
    const lastRun = parseInt(settings[0]?.value || "0");
    const now = Date.now();
    const intervalMinutes = parseInt(process.env.CRON_POSTS_INTERVAL || "10");
    const intervalMs = intervalMinutes * 60 * 1000;

    if (!isDev && now - lastRun < intervalMs) {
      const minutesLeft = Math.ceil((intervalMs - (now - lastRun)) / 60000);
      return NextResponse.json({
        success: false,
        message: `Too early. Please wait ${minutesLeft} more minutes.`
      }, { status: 429 });
    }

    await pool.query("UPDATE settings SET value = ? WHERE `key` = 'last_cron_run'", [now.toString()]);

    const schedulerSchema = await getPostingSchedulerSchema();
    const currentSlot = getCurrentPostingSlot();
    const currentSlotTimeForDb = `${currentSlot.postingSlotTime}:00`;
    const currentSlotStart = `${currentSlot.postingSlotDate} ${currentSlotTimeForDb}`;
    const channelSlotLimit = Math.max(1, parseInt(process.env.CRON_CHANNEL_SLOT_LIMIT || "200"));
    const campaignLimit = Math.max(1, parseInt(process.env.CRON_CAMPAIGN_LIMIT || "200"));

    if (!schedulerSchema.hasChannelPostingTimes) {
      console.warn("channels.posting_times column is missing; process-ads is using legacy 6-hour channel cooldown fallback");
    }

    const [campaigns]: any = await pool.query(`
      SELECT *
      FROM campaigns
      WHERE status = 'active' AND budget > 0 AND type != 'broadcast'
      ORDER BY budget DESC
      LIMIT ?
    `, [campaignLimit]);

    const timingConditions = schedulerSchema.hasChannelPostingTimes
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

    const timingParams = schedulerSchema.hasChannelPostingTimes
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

    const [channels]: any = await pool.query(`
      SELECT c.*
      FROM channels c
      WHERE c.status = 'active' AND c.is_deleted = FALSE
      AND (
        SELECT COUNT(*) FROM campaign_posts cp
        WHERE cp.channel_id = c.id AND cp.created_at > NOW() - INTERVAL 1 DAY
      ) < c.posts_per_day
      ${timingConditions}
      ORDER BY c.id ASC
      LIMIT ?
    `, [...timingParams, channelSlotLimit]);

    if (campaigns.length === 0 || channels.length === 0) {
      console.info("process-ads allocation skipped", {
        eligible_campaigns_count: campaigns.length,
        eligible_channels_count: channels.length
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

    const activePostCondition = schedulerSchema.hasPostDeletedAtColumn
      ? "(status IN ('active', 'posted', 'sent') AND deleted_at IS NULL)"
      : "status IN ('active', 'posted', 'sent')";

    const [recentPosts]: any = await pool.query(`
      SELECT campaign_id, channel_id, created_at, status${schedulerSchema.hasPostDeletedAtColumn ? ", deleted_at" : ""}
      FROM campaign_posts
      WHERE campaign_id IN (?) AND channel_id IN (?)
      AND (
        created_at > NOW() - INTERVAL 24 HOUR
        OR ${activePostCondition}
      )
    `, [campaignIds, channelIds]);

    const postMaps = buildPostMaps(recentPosts, schedulerSchema.hasPostDeletedAtColumn);
    const placementCounts = new Map<number, number>();
    const campaignResults = new Map<number, any>();
    const skippedReasons: Record<string, number> = {};
    const results = [];
    const dominanceCap = getWindowDominanceCap(channels.length);
    let selectedPlacements = 0;
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

        if (postMaps.activeUndeleted.has(key)) {
          incrementSkip("active_old_post_exists");
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
            maxUnderDelivery
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

      const insertColumns = ["campaign_id", "channel_id", "channel_username", "status"];
      const insertParams = [campaign.id, channel.id, channel.username, "active"];

      if (schedulerSchema.hasPostSlotColumns) {
        insertColumns.push("posting_slot_date", "posting_slot_time");
        insertParams.push(currentSlot.postingSlotDate, currentSlotTimeForDb);
      }

      const insertPlaceholders = insertColumns.map(() => "?").join(", ");
      const [insertPost]: any = await pool.query(
        `INSERT INTO campaign_posts (${insertColumns.join(", ")}) VALUES (${insertPlaceholders})`,
        insertParams
      );

      const postId = insertPost.insertId;
      const parseModeMap: any = { html: "HTML", markdown: "MarkdownV2", none: undefined };
      const parseMode = parseModeMap[campaign.parse_mode] || "HTML";
      const domain = process.env.DOMAIN;
      const host = domain ? `https://${domain}` : (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin);
      const buttonUrl = campaign.type === "clicks"
        ? `${host}/api/clicks/${campaign.id}/${postId}`
        : campaign.link;

      const replyMarkup = {
        inline_keyboard: [
          [{ text: campaign.button_text, url: buttonUrl }],
          [{ text: "Advertise with Ads galaxy", url: "https://t.me/Ads_Galaxy_bot?start=advertise" }]
        ]
      };

      const result = await sendTelegramMessage(channel.chat_id, campaign.message_text, {
        photo: campaign.image_url,
        parse_mode: parseMode,
        reply_markup: replyMarkup
      });

      if (result && result.ok) {
        const messageId = result.result.message_id;

        await pool.query(
          "UPDATE campaign_posts SET message_id = ? WHERE id = ?",
          [messageId, postId]
        );

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
          "budget_weighted_placement"
        );
      } else {
        await pool.query("DELETE FROM campaign_posts WHERE id = ?", [postId]);
        incrementSkip("telegram_send_failed");
        await recordDeliveryEvent(
          schedulerSchema.hasCampaignDeliveryEvents,
          campaign.id,
          channel.id,
          "send_failed",
          selected.score.score,
          result?.description || "Telegram send failed"
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
      campaign_limit: campaignLimit
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
      }
    });
  } catch (error) {
    console.error("Cron Processing Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
