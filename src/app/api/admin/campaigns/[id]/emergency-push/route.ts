import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { campaignCategoryMatches } from "@/lib/campaignCategories";
import { deleteCampaignPosts, type CampaignPostDeletionSummary } from "@/lib/campaignPostDeletion";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { settleChannelCampaigns } from "@/lib/channelSettlement";
import { acquireCronLock, releaseCronLock } from "@/lib/cronSecurity";
import { SAFE_TELEGRAM_PARSE_MODE, sendTelegramMessage } from "@/lib/telegram";
import {
  autoPauseBot,
  checkBotHealth,
  classifyBotTokenFailure,
  markBotUserDeliverySuccess,
  markBotUserInactive,
  recordBotBroadcastSuccess,
  sendWithRetries,
} from "@/lib/botLifecycle";
import { isBotEncryptionError, loadBotToken } from "@/lib/botIntegration";
import { createSystemLog } from "@/lib/systemLogs";
import { botUserBroadcastEligibleCondition } from "@/lib/botAudience";
import { composeCampaignCreativeText } from "@/lib/campaignCreative";
import { campaignExcludesIdentifier, loadCampaignExclusions } from "@/lib/campaignInventoryExclusions";

export const dynamic = "force-dynamic";

const MAX_EMERGENCY_CHANNELS = 1000;
const MAX_EMERGENCY_BROADCAST_USERS = 1000;
const ACTIVE_POST_STATUSES = ["active", "posted", "sent"];
const VALID_MODES = new Set(["fill_empty_slots", "replace_everything"]);

type EmergencyMode = "fill_empty_slots" | "replace_everything";

type CampaignRow = RowDataPacket & {
  id: number;
  user_id: number;
  name: string;
  status: string;
  budget: string | number;
  category: string;
  continents: string;
  parse_mode: string;
  type: string;
  link: string;
  button_text: string;
  campaign_title?: string | null;
  message_text: string;
  image_url: string | null;
};

type ChannelRow = RowDataPacket & {
  id: number;
  user_id: number;
  chat_id: string;
  username: string;
  categories: string | string[] | null;
  audience_continents: string | string[] | null;
};

type BotRow = RowDataPacket & {
  id: number;
  user_id: number;
  bot_username: string | null;
  bot_token: string;
  bot_token_encrypted: string | null;
  categories: string | string[] | null;
  continents: string | string[] | null;
  posts_per_day: number;
};

type BroadcastUserRow = RowDataPacket & {
  id: number;
  chat_id: string | number;
};

type EmergencySchema = {
  hasPostDeletedAtColumn: boolean;
  hasPostSlotColumns: boolean;
  hasPostPostingModeColumn: boolean;
  hasDeliveryConfirmedAtColumn: boolean;
  hasDeliveryFailedAtColumn: boolean;
  hasDeliveryFailureReasonColumn: boolean;
  hasCampaignDeliveryEvents: boolean;
};

type BroadcastSchema = {
  hasBotUserChatId: boolean;
  hasDeliveryStatus: boolean;
  hasDeliveryCost: boolean;
  hasDeliveryPublisherReward: boolean;
  hasDeliveryRetryCount: boolean;
  hasDeliverySuccessAt: boolean;
  hasDeliveryFailureAt: boolean;
  hasDeliveryFailureReason: boolean;
  hasDeliveryTelegramError: boolean;
};

type ColumnRow = RowDataPacket & {
  TABLE_NAME: string;
  COLUMN_NAME: string | null;
};

type IdRow = RowDataPacket & {
  id: number;
};

type TelegramSendResponse = {
  ok?: boolean;
  description?: string;
  result?: {
    message_id?: number;
  };
};

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

function normalizeFailureReason(value?: string) {
  const text = String(value || "").toLowerCase();
  if (text.includes("blocked")) return "user_blocked_bot";
  if (text.includes("user not found")) return "user_not_found";
  if (text.includes("chat not found")) return "chat_not_found";
  if (text.includes("forbidden") || text.includes("initiate conversation")) return "forbidden";
  if (text.includes("token") || text.includes("unauthorized")) return "bot_token_invalid";
  if (text.includes("timeout")) return "telegram_timeout";
  if (text.includes("paused")) return "bot_paused";
  if (text.includes("error")) return "system_error";
  return "unknown_error";
}

function campaignMatchesBot(campaign: CampaignRow, bot: BotRow) {
  const botCategories = parseJsonArray(bot.categories);
  const categoryMatches = campaignCategoryMatches(campaign.category, botCategories);

  if (!categoryMatches) return false;

  const campaignContinents = parseJsonArray(campaign.continents).map(normalizeTarget);
  const botContinents = parseJsonArray(bot.continents).map(normalizeTarget);

  return campaignContinents.includes("global")
    || botContinents.includes("global")
    || campaignContinents.some((continent) => botContinents.includes(continent));
}

async function getEmergencySchema(): Promise<EmergencySchema> {
  const [rows] = await pool.query<ColumnRow[]>(`
    SELECT TABLE_NAME, COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND (
        (TABLE_NAME = 'campaign_posts' AND COLUMN_NAME IN ('posting_slot_date', 'posting_slot_time', 'deleted_at', 'posting_mode', 'delivery_confirmed_at', 'delivery_failed_at', 'delivery_failure_reason'))
        OR (TABLE_NAME = 'campaign_delivery_events')
      )
  `);

  const columns = new Set(rows.map((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
  const tables = new Set(rows.map((row) => row.TABLE_NAME));

  return {
    hasPostDeletedAtColumn: columns.has("campaign_posts.deleted_at"),
    hasPostSlotColumns: columns.has("campaign_posts.posting_slot_date") && columns.has("campaign_posts.posting_slot_time"),
    hasPostPostingModeColumn: columns.has("campaign_posts.posting_mode"),
    hasDeliveryConfirmedAtColumn: columns.has("campaign_posts.delivery_confirmed_at"),
    hasDeliveryFailedAtColumn: columns.has("campaign_posts.delivery_failed_at"),
    hasDeliveryFailureReasonColumn: columns.has("campaign_posts.delivery_failure_reason"),
    hasCampaignDeliveryEvents: tables.has("campaign_delivery_events"),
  };
}

async function getBroadcastSchema(): Promise<BroadcastSchema> {
  const [rows] = await pool.query<ColumnRow[]>(`
    SELECT TABLE_NAME, COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND (
        (TABLE_NAME = 'bot_users' AND COLUMN_NAME = 'chat_id')
        OR (TABLE_NAME = 'broadcast_deliveries' AND COLUMN_NAME IN ('status', 'cost', 'publisher_reward', 'retry_count', 'last_success_at', 'last_failure_at', 'failure_reason', 'telegram_error'))
      )
  `);

  const columns = new Set(rows.map((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));

  return {
    hasBotUserChatId: columns.has("bot_users.chat_id"),
    hasDeliveryStatus: columns.has("broadcast_deliveries.status"),
    hasDeliveryCost: columns.has("broadcast_deliveries.cost"),
    hasDeliveryPublisherReward: columns.has("broadcast_deliveries.publisher_reward"),
    hasDeliveryRetryCount: columns.has("broadcast_deliveries.retry_count"),
    hasDeliverySuccessAt: columns.has("broadcast_deliveries.last_success_at"),
    hasDeliveryFailureAt: columns.has("broadcast_deliveries.last_failure_at"),
    hasDeliveryFailureReason: columns.has("broadcast_deliveries.failure_reason"),
    hasDeliveryTelegramError: columns.has("broadcast_deliveries.telegram_error"),
  };
}

function getActiveUndeletedCondition(schema: EmergencySchema, alias = "cp") {
  return schema.hasPostDeletedAtColumn
    ? `${alias}.status IN (?) AND ${alias}.deleted_at IS NULL`
    : `${alias}.status IN (?)`;
}

async function recordDeliveryEvent(
  enabled: boolean,
  campaignId: number,
  channelId: number,
  postId: number | null,
  eventType: string,
  metadata: Record<string, unknown>
) {
  if (!enabled) return;

  try {
    await pool.query(`
      INSERT INTO campaign_delivery_events (campaign_id, channel_id, campaign_post_id, event_type, score, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
    `, [campaignId, channelId, postId, eventType, null, JSON.stringify(metadata)]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown delivery event error";
    console.warn("Failed to record emergency push delivery event", {
      campaign_id: campaignId,
      channel_id: channelId,
      event_type: eventType,
      error: message,
    });
  }
}

async function hasActiveUndeletedPost(channelId: number, schema: EmergencySchema) {
  const [rows] = await pool.query<IdRow[]>(`
    SELECT id
    FROM campaign_posts cp
    WHERE cp.channel_id = ?
      AND ${getActiveUndeletedCondition(schema)}
    LIMIT 1
  `, [channelId, ACTIVE_POST_STATUSES]);

  return rows.length > 0;
}

async function hasActiveUndeletedCampaignPost(campaignId: number, channelId: number, schema: EmergencySchema) {
  const [rows] = await pool.query<IdRow[]>(`
    SELECT id
    FROM campaign_posts cp
    WHERE cp.campaign_id = ?
      AND cp.channel_id = ?
      AND ${getActiveUndeletedCondition(schema)}
    LIMIT 1
  `, [campaignId, channelId, ACTIVE_POST_STATUSES]);

  return rows.length > 0;
}

async function getEligibleChannels(campaign: CampaignRow, schema: EmergencySchema, mode: EmergencyMode) {
  const activeCondition = getActiveUndeletedCondition(schema);
  const emptySlotCondition = mode === "fill_empty_slots"
    ? `AND NOT EXISTS (
        SELECT 1 FROM campaign_posts cp
        WHERE cp.channel_id = c.id
          AND ${activeCondition}
      )`
    : "";

  const [channels] = await pool.query<ChannelRow[]>(`
    SELECT c.*
    FROM channels c
    WHERE c.status = 'active'
      AND c.is_deleted = FALSE
      AND c.user_id != ?
      AND c.chat_id IS NOT NULL
      AND c.chat_id != ''
      ${emptySlotCondition}
    ORDER BY c.id ASC
    LIMIT ?
  `, mode === "fill_empty_slots"
    ? [campaign.user_id, ACTIVE_POST_STATUSES, MAX_EMERGENCY_CHANNELS + 1]
    : [campaign.user_id, MAX_EMERGENCY_CHANNELS + 1]
  );

  const channelExclusions = await loadCampaignExclusions(pool, "campaign", [Number(campaign.id)], "channel");
  const eligibleChannels = channels.filter((channel) => !campaignExcludesIdentifier(channelExclusions, Number(campaign.id), channel.username));

  return {
    eligibleChannels: eligibleChannels.slice(0, MAX_EMERGENCY_CHANNELS),
    skippedByExclusion: channels.length - eligibleChannels.length,
    skippedByLimit: Math.max(0, eligibleChannels.length - MAX_EMERGENCY_CHANNELS),
  };
}

function getEmergencySlot() {
  const now = new Date();
  const postingSlotDate = now.toISOString().slice(0, 10);
  const postingSlotTime = now.toTimeString().slice(0, 8);

  return { postingSlotDate, postingSlotTime };
}

async function postCampaignToChannel(options: {
  campaign: CampaignRow;
  channel: ChannelRow;
  schema: EmergencySchema;
  requestOrigin: string;
}) {
  const { campaign, channel, schema, requestOrigin } = options;
  const slot = getEmergencySlot();
  const insertColumns = ["campaign_id", "channel_id", "channel_username", "status"];
  const insertParams: Array<number | string | null> = [campaign.id, channel.id, channel.username, "active"];

  if (schema.hasPostPostingModeColumn) {
    insertColumns.push("posting_mode");
    insertParams.push("emergency");
  }

  if (schema.hasPostSlotColumns) {
    insertColumns.push("posting_slot_date", "posting_slot_time");
    insertParams.push(slot.postingSlotDate, slot.postingSlotTime);
  }

  const insertPlaceholders = insertColumns.map(() => "?").join(", ");
  const [insertPost] = await pool.query<ResultSetHeader>(
    `INSERT INTO campaign_posts (${insertColumns.join(", ")}) VALUES (${insertPlaceholders})`,
    insertParams
  );

  const postId = insertPost.insertId;
  const domain = process.env.DOMAIN;
  const host = domain ? `https://${domain}` : (process.env.NEXT_PUBLIC_APP_URL || requestOrigin);
  const buttonUrl = campaign.type === "clicks"
    ? `${host}/api/clicks/${campaign.id}/${postId}`
    : campaign.link;
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || process.env.NEXT_PUBLIC_BOT_USERNAME || "Ads_Galaxy_bot";

  const replyMarkup = {
    inline_keyboard: [
      [{ text: campaign.button_text, url: buttonUrl }],
      [{ text: "Advertise with Ads galaxy", url: `https://t.me/${botUsername}?start=advertise` }],
    ],
  };

  const result = await sendTelegramMessage(channel.chat_id, composeCampaignCreativeText(campaign.campaign_title, campaign.message_text), {
    photo: campaign.image_url,
    parse_mode: SAFE_TELEGRAM_PARSE_MODE,
    reply_markup: replyMarkup,
  }) as TelegramSendResponse | undefined;

  if (result?.ok && result.result?.message_id) {
    await pool.query(
      schema.hasDeliveryConfirmedAtColumn
        ? "UPDATE campaign_posts SET message_id = ?, delivery_confirmed_at = NOW() WHERE id = ?"
        : "UPDATE campaign_posts SET message_id = ? WHERE id = ?",
      [result.result.message_id, postId]
    );
    await recordDeliveryEvent(schema.hasCampaignDeliveryEvents, campaign.id, channel.id, postId, "emergency_posted", {
      mode: "emergency_push",
    });
    return { ok: true, postId, messageId: result.result.message_id };
  }

  const failedUpdates = ["status = 'delivery_failed'"];
  const failedParams: Array<string | number> = [];
  if (schema.hasDeliveryFailedAtColumn) failedUpdates.push("delivery_failed_at = NOW()");
  if (schema.hasDeliveryFailureReasonColumn) {
    failedUpdates.push("delivery_failure_reason = ?");
    failedParams.push((result?.description || "Telegram send failed").slice(0, 500));
  }
  failedParams.push(postId);
  await pool.query(`UPDATE campaign_posts SET ${failedUpdates.join(", ")} WHERE id = ?`, failedParams);
  await recordDeliveryEvent(schema.hasCampaignDeliveryEvents, campaign.id, channel.id, postId, "emergency_send_failed", {
    reason: result?.description || "Telegram send failed",
  });

  return { ok: false, postId, reason: result?.description || "Telegram send failed" };
}

async function deleteActivePostsForReplacementSafely(campaignId: number): Promise<CampaignPostDeletionSummary> {
  try {
    return await deleteCampaignPosts({ campaignId, successStatus: "replaced" });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Emergency campaign post deletion failed";
    console.warn("Emergency campaign post deletion failed", { campaign_id: campaignId, error: message });
    return {
      checked: 0,
      total: 0,
      deleted: 0,
      failed: 1,
      retry: 0,
      skipped: 0,
      failedIds: [],
      details: [{ id: 0, status: "error", reason: message }],
    };
  }
}

async function getEligibleBroadcastDispatches(campaign: CampaignRow, schema: BroadcastSchema) {
  const [bots] = await pool.query<BotRow[]>(`
    SELECT *
    FROM bots
    WHERE status = 'active'
      AND is_deleted = FALSE
      AND COALESCE(health_status, 'active') = 'active'
      AND user_id != ?
    ORDER BY id ASC
  `, [campaign.user_id]);

  const healthyBots: BotRow[] = [];
  for (const bot of bots) {
    try {
      bot.bot_token = await loadBotToken(pool, bot);
    } catch (error: unknown) {
      if (!isBotEncryptionError(error)) throw error;
      console.error("Emergency push bot credential decryption skipped", { bot_id: bot.id, code: error.code });
      await createSystemLog({
        logType: "system_error",
        status: "failed",
        title: "Emergency push bot credential decryption failed",
        summary: "Bot was skipped because its encrypted token could not be decrypted. The bot was not paused.",
        failedCount: 1,
        skippedCount: 1,
        failureReasons: { [error.code]: 1 },
        affectedEntities: [{ bot_id: bot.id }],
        metadata: { route: "/api/admin/campaigns/[id]/emergency-push", bot_id: bot.id, code: error.code },
      });
      continue;
    }
    const health = await checkBotHealth({ id: bot.id, bot_token: bot.bot_token });
    if (health.ok) healthyBots.push(bot);
  }

  const botExclusions = await loadCampaignExclusions(pool, "campaign", [Number(campaign.id)], "bot");
  const exclusionFilteredBots = healthyBots.filter((bot) => !campaignExcludesIdentifier(botExclusions, Number(campaign.id), bot.bot_username));
  const eligibleBots = exclusionFilteredBots.filter((bot) => campaignMatchesBot(campaign, bot));
  const dispatches: Array<{ bot: BotRow; user: BroadcastUserRow }> = [];

  for (const bot of eligibleBots) {
    if (dispatches.length >= MAX_EMERGENCY_BROADCAST_USERS + 1) break;

    const hoursInterval = 24 / Math.max(1, Number(bot.posts_per_day) || 1);
    const chatIdExpression = schema.hasBotUserChatId ? "bu.chat_id" : "bu.user_id";
      const [users] = await pool.query<BroadcastUserRow[]>(`
        SELECT bu.id, ${chatIdExpression} as chat_id
        FROM bot_users bu
        JOIN bots b ON b.id = bu.bot_id
        WHERE bu.bot_id = ?
        AND ${botUserBroadcastEligibleCondition("bu", "b")}
        AND (bu.last_broadcast_at IS NULL OR bu.last_broadcast_at < NOW() - INTERVAL ? HOUR)
        AND (
          SELECT COUNT(*)
          FROM broadcast_deliveries bd
          WHERE bd.user_id = bu.id
            AND bd.created_at > NOW() - INTERVAL 1 DAY
        ) < ?
      ORDER BY CASE WHEN bu.status='active' THEN 0 ELSE 1 END, bu.id ASC
      LIMIT ?
    `, [bot.id, hoursInterval, Math.max(1, Number(bot.posts_per_day) || 1), MAX_EMERGENCY_BROADCAST_USERS + 1 - dispatches.length]);

    for (const user of users) {
      dispatches.push({ bot, user });
      if (dispatches.length >= MAX_EMERGENCY_BROADCAST_USERS + 1) break;
    }
  }

  return {
    dispatches: dispatches.slice(0, MAX_EMERGENCY_BROADCAST_USERS),
    skippedByExclusion: healthyBots.length - exclusionFilteredBots.length,
    skippedByLimit: Math.max(0, dispatches.length - MAX_EMERGENCY_BROADCAST_USERS),
  };
}

function requireBillableBroadcastSchema(schema: BroadcastSchema) {
  if (!schema.hasDeliveryStatus || !schema.hasDeliveryCost || !schema.hasDeliveryPublisherReward) {
    throw new Error("broadcast_billing_schema_missing");
  }
}

async function getBroadcastRewardPercentage() {
  const [rows] = await pool.query<Array<RowDataPacket & { value: string }>>(
    "SELECT value FROM settings WHERE `key` = 'broadcast_ad_reward_percentage' LIMIT 1"
  );
  const value = Number.parseFloat(String(rows[0]?.value || "50"));
  return Math.min(1, Math.max(0, (Number.isFinite(value) ? value : 50) / 100));
}

async function reserveEmergencyBroadcastDelivery(input: {
  schema: BroadcastSchema;
  campaign: CampaignRow;
  bot: BotRow;
  user: BroadcastUserRow;
  cost: number;
}) {
  requireBillableBroadcastSchema(input.schema);
  if (!Number.isFinite(input.cost) || input.cost <= 0) throw new Error("invalid_campaign_cost");

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [campaignRows] = await conn.query<Array<RowDataPacket & { budget: string | number; status: string; daily_budget_limit: string | number | null }>>(
      "SELECT budget,status,daily_budget_limit FROM campaigns WHERE id=? FOR UPDATE",
      [input.campaign.id]
    );
    const campaign = campaignRows[0];
    if (!campaign || campaign.status !== "active") {
      await conn.rollback();
      return { ok: false as const, reason: "campaign_not_active" };
    }
    if (Number(campaign.budget || 0) + 1e-10 < input.cost) {
      await conn.query(
        "UPDATE campaigns SET status='paused',pause_reason='insufficient_budget_for_delivery',paused_at=NOW() WHERE id=? AND status='active'",
        [input.campaign.id]
      );
      await conn.commit();
      return { ok: false as const, reason: "campaign_budget_exhausted" };
    }
    if (Number(campaign.daily_budget_limit || 0) > 0) {
      const [[daily]] = await conn.query<Array<RowDataPacket & { spend: string | number }>>(
        "SELECT COALESCE(SUM(cost),0) spend FROM broadcast_deliveries WHERE campaign_id=? AND created_at>=CURDATE() AND status IN ('pending','sent')",
        [input.campaign.id]
      );
      if (Number(daily?.spend || 0) + input.cost > Number(campaign.daily_budget_limit)) {
        await conn.rollback();
        return { ok: false as const, reason: "daily_budget_limit" };
      }
    }

    const [budgetUpdate] = await conn.query<ResultSetHeader>(
      "UPDATE campaigns SET budget=budget-? WHERE id=? AND status='active' AND budget>=?",
      [input.cost, input.campaign.id, input.cost]
    );
    if (budgetUpdate.affectedRows !== 1) {
      await conn.rollback();
      return { ok: false as const, reason: "campaign_budget_race" };
    }

    const columns = ["campaign_id", "bot_id", "user_id", "chat_id", "cost", "publisher_reward", "status"];
    const params: Array<number | string> = [input.campaign.id, input.bot.id, input.user.id, String(input.user.chat_id), input.cost, 0, "pending"];
    if (input.schema.hasDeliveryRetryCount) {
      columns.push("retry_count");
      params.push(0);
    }
    const placeholders = columns.map(() => "?").join(",");
    const [deliveryInsert] = await conn.query<ResultSetHeader>(
      `INSERT INTO broadcast_deliveries (${columns.join(",")}) VALUES (${placeholders})`,
      params
    );
    const [[updatedCampaign]] = await conn.query<Array<RowDataPacket & { budget: string | number }>>(
      "SELECT budget FROM campaigns WHERE id=?",
      [input.campaign.id]
    );
    await conn.commit();
    return { ok: true as const, deliveryId: Number(deliveryInsert.insertId), remainingBudget: Number(updatedCampaign?.budget || 0) };
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    conn.release();
  }
}

async function finalizeEmergencyBroadcastDelivery(input: {
  schema: BroadcastSchema;
  deliveryId: number;
  reward: number;
  attempts: number;
}) {
  const assignments = ["publisher_reward=?", "status='sent'"];
  const params: Array<number | string> = [input.reward];
  if (input.schema.hasDeliveryRetryCount) {
    assignments.push("retry_count=?");
    params.push(input.attempts);
  }
  if (input.schema.hasDeliverySuccessAt) assignments.push("last_success_at=NOW()");
  if (input.schema.hasDeliveryFailureReason) assignments.push("failure_reason=NULL");
  if (input.schema.hasDeliveryTelegramError) assignments.push("telegram_error=NULL");
  params.push(input.deliveryId);

  const [updated] = await pool.query<ResultSetHeader>(
    `UPDATE broadcast_deliveries SET ${assignments.join(",")} WHERE id=? AND status='pending'`,
    params
  );
  if (updated.affectedRows !== 1) throw new Error("broadcast_finalize_race");
}

async function refundEmergencyBroadcastDelivery(input: {
  schema: BroadcastSchema;
  deliveryId: number;
  campaignId: number;
  failureReason: string;
  telegramError: string;
  attempts: number;
}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<Array<RowDataPacket & { cost: string | number; status: string }>>(
      "SELECT cost,status FROM broadcast_deliveries WHERE id=? FOR UPDATE",
      [input.deliveryId]
    );
    const delivery = rows[0];
    if (!delivery || delivery.status !== "pending") {
      await conn.commit();
      return;
    }
    const reservedCost = Number(delivery.cost || 0);
    await conn.query("UPDATE campaigns SET budget=budget+? WHERE id=?", [reservedCost, input.campaignId]);
    const assignments = ["cost=0", "publisher_reward=0", "status='failed'"];
    const params: Array<number | string> = [];
    if (input.schema.hasDeliveryFailureReason) {
      assignments.push("failure_reason=?");
      params.push(input.failureReason);
    }
    if (input.schema.hasDeliveryTelegramError) {
      assignments.push("telegram_error=?");
      params.push(input.telegramError.slice(0, 500));
    }
    if (input.schema.hasDeliveryRetryCount) {
      assignments.push("retry_count=?");
      params.push(input.attempts);
    }
    if (input.schema.hasDeliveryFailureAt) assignments.push("last_failure_at=NOW()");
    params.push(input.deliveryId);
    const [updated] = await conn.query<ResultSetHeader>(
      `UPDATE broadcast_deliveries SET ${assignments.join(",")} WHERE id=? AND status='pending'`,
      params
    );
    if (updated.affectedRows !== 1) throw new Error("broadcast_refund_race");
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    conn.release();
  }
}

async function postBroadcastToBotUser(options: {
  campaign: CampaignRow;
  bot: BotRow;
  user: BroadcastUserRow;
  schema: BroadcastSchema;
  rewardPercentage: number;
}) {
  const { campaign, bot, user, schema } = options;
  const replyMarkup = {
    inline_keyboard: [[
      { text: campaign.button_text, url: campaign.link },
    ]],
  };
  const cost = Number((Number(campaign.cpm || 0) / 1000).toFixed(8));
  const reward = Number((cost * options.rewardPercentage).toFixed(8));
  const reservation = await reserveEmergencyBroadcastDelivery({ schema, campaign, bot, user, cost });
  if (!reservation.ok) return { ok: false, reason: reservation.reason };

  let sendResult;
  try {
    sendResult = await sendWithRetries(() => sendTelegramMessage(user.chat_id, composeCampaignCreativeText(campaign.campaign_title, campaign.message_text), {
      photo: campaign.image_url,
      parse_mode: SAFE_TELEGRAM_PARSE_MODE,
      reply_markup: replyMarkup,
      token: bot.bot_token,
    }) as Promise<TelegramSendResponse | undefined>);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram send failed";
    await refundEmergencyBroadcastDelivery({
      schema,
      deliveryId: reservation.deliveryId,
      campaignId: campaign.id,
      failureReason: normalizeFailureReason(message),
      telegramError: message,
      attempts: 1,
    });
    throw error;
  }
  const result = sendResult.result;

  if (result?.ok) {
    await finalizeEmergencyBroadcastDelivery({
      schema,
      deliveryId: reservation.deliveryId,
      reward,
      attempts: sendResult.attempts || 1,
    });
    await pool.query("UPDATE bot_users SET last_broadcast_at = NOW() WHERE id = ?", [user.id]);
    await markBotUserDeliverySuccess(user.id);
    await recordBotBroadcastSuccess(bot.id);
    if (reservation.remainingBudget <= 0) {
      await pool.query(
        "UPDATE campaigns SET status='budget_exhausted',budget=0,budget_exhausted_at=NOW(),pause_reason='budget_exhausted' WHERE id=? AND status='active'",
        [campaign.id]
      );
    }
    return { ok: true, cost, reward, remainingBudget: reservation.remainingBudget };
  }

  const reason = result?.description || "Telegram send failed";
  await refundEmergencyBroadcastDelivery({
    schema,
    deliveryId: reservation.deliveryId,
    campaignId: campaign.id,
    failureReason: normalizeFailureReason(reason),
    telegramError: reason,
    attempts: sendResult.attempts || 1,
  });
  if (sendResult.failure) {
    const botFailure = classifyBotTokenFailure(result?.description);
    if (botFailure) {
      await autoPauseBot(bot.id, botFailure);
    } else {
      await markBotUserInactive(user.id, sendResult.failure);
    }
  }

  return { ok: false, reason };
}

async function emergencyPushBroadcast(campaign: CampaignRow, mode: EmergencyMode) {
  const schema = await getBroadcastSchema();
  requireBillableBroadcastSchema(schema);
  const rewardPercentage = await getBroadcastRewardPercentage();
  const { dispatches, skippedByLimit, skippedByExclusion } = await getEligibleBroadcastDispatches(campaign, schema);
  const failedUsers: Array<{ botId: number; userId: number; reason: string }> = [];
  let attempted = 0;
  let posted = 0;

  for (const dispatch of dispatches) {
    attempted++;

    try {
      const result = await postBroadcastToBotUser({
        campaign,
        bot: dispatch.bot,
        user: dispatch.user,
        schema,
        rewardPercentage,
      });

      if (result.ok) {
        posted++;
      } else {
        failedUsers.push({ botId: dispatch.bot.id, userId: dispatch.user.id, reason: result.reason || "Telegram send failed" });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Emergency broadcast failed";
      failedUsers.push({ botId: dispatch.bot.id, userId: dispatch.user.id, reason: message });
    }
  }

  const failed = failedUsers.length;
  const skipped = skippedByLimit + skippedByExclusion;

  await recordAdminActionAudit({
    action: "emergency_push",
    entityType: "campaign",
    entityId: campaign.id,
    reason: mode,
    metadata: {
      mode,
      delivery_type: "broadcast",
      eligible_bot_users: dispatches.length,
      attempted,
      success: posted,
      failed,
      skipped,
      timestamp: new Date().toISOString(),
    },
  });

  return NextResponse.json({
    success: true,
    mode,
    campaignId: campaign.id,
    deliveryType: "broadcast",
    eligibleBotUsers: dispatches.length,
    eligibleChannels: 0,
    attempted,
    posted,
    failed,
    skipped,
    deleteSummary: null,
    failedUsers,
    failedChannels: [],
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response } = await requireAdminPermission("dangerous");
  if (response) return response;

  const { id } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const mode = body.mode as EmergencyMode;

  if (!VALID_MODES.has(mode)) {
    return NextResponse.json({ error: "Invalid emergency push mode" }, { status: 400 });
  }

  if (mode === "replace_everything" && body.confirmation !== "CONFIRM") {
    return NextResponse.json({ error: "Type CONFIRM to run Replace Everything" }, { status: 400 });
  }

  let lock: { lockName: string; ownerToken: string } | null = null;
  try {
    lock = await acquireCronLock(`admin-emergency-push-${id}`, 900);
    if (!lock) {
      return NextResponse.json({
        error: "Emergency push is already running for this campaign. Please wait for it to finish.",
      }, { status: 409 });
    }

    const [campaignRows] = await pool.query<CampaignRow[]>("SELECT * FROM campaigns WHERE id = ?", [id]);

    if (campaignRows.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const campaign = campaignRows[0] as CampaignRow;

    if (campaign.status !== "active") {
      return NextResponse.json({ error: "Only active campaigns can be emergency pushed" }, { status: 400 });
    }

    if (parseFloat(String(campaign.budget || "0")) <= 0) {
      return NextResponse.json({ error: "Campaign budget must be greater than 0" }, { status: 400 });
    }

    if (!campaign.message_text || !campaign.button_text || !campaign.link) {
      return NextResponse.json({ error: "Campaign must have message text, button text, and link before emergency push" }, { status: 400 });
    }

    if (campaign.type === "broadcast") {
      return emergencyPushBroadcast(campaign, mode);
    }

    const schema = await getEmergencySchema();
    let settlementSummary = null;
    let deleteSummary = null;

    if (mode === "replace_everything") {
      const settlement = await settleChannelCampaigns({
        campaignId: campaign.id,
        skipGlobalMaintenance: true,
        campaignStatuses: ["active"],
      });
      settlementSummary = {
        settledPosts: settlement.settledPosts,
        failedPosts: settlement.failedPosts,
        failedDetails: settlement.failedDetails,
        advertiserDebited: settlement.advertiserDebited,
        publisherCredited: settlement.publisherCredited,
      };

      if (settlement.failedPosts > 0) {
        return NextResponse.json({
          success: false,
          error: "Replace Everything stopped because some active posts could not be settled safely.",
          settlement: settlementSummary,
        }, { status: 409 });
      }

      deleteSummary = await deleteActivePostsForReplacementSafely(campaign.id);
    }
    const { eligibleChannels, skippedByLimit, skippedByExclusion } = await getEligibleChannels(campaign, schema, mode);
    const failedChannels: Array<{ channelId: number; reason: string }> = [];
    let attempted = 0;
    let posted = 0;
    let skipped = skippedByLimit + skippedByExclusion;

    for (const channel of eligibleChannels) {
      if (mode === "fill_empty_slots" && await hasActiveUndeletedPost(channel.id, schema)) {
        skipped++;
        failedChannels.push({ channelId: channel.id, reason: "active_undeleted_post_exists" });
        continue;
      }

      if (mode === "replace_everything" && await hasActiveUndeletedCampaignPost(campaign.id, channel.id, schema)) {
        skipped++;
        failedChannels.push({ channelId: channel.id, reason: "active_same_campaign_post_exists" });
        continue;
      }

      attempted++;

      try {
        const result = await postCampaignToChannel({
          campaign,
          channel,
          schema,
          requestOrigin: new URL(request.url).origin,
        });

        if (result.ok) {
          posted++;
        } else {
          failedChannels.push({ channelId: channel.id, reason: result.reason || "Telegram send failed" });
          console.warn("Emergency push channel send failed", {
            campaign_id: campaign.id,
            channel_id: channel.id,
            reason: result.reason || "Telegram send failed",
          });
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Emergency post failed";
        failedChannels.push({ channelId: channel.id, reason: message });
        console.warn("Emergency push channel processing failed", {
          campaign_id: campaign.id,
          channel_id: channel.id,
          reason: message,
        });
      }
    }

    const failed = failedChannels.filter((channel) => !["active_undeleted_post_exists", "active_same_campaign_post_exists"].includes(channel.reason)).length;

    await recordAdminActionAudit({
      action: "emergency_push",
      entityType: "campaign",
      entityId: campaign.id,
      reason: mode,
      metadata: {
        mode,
        eligible_channels: eligibleChannels.length,
        attempted,
        success: posted,
        failed,
        skipped,
        delete_summary: deleteSummary,
        settlement_summary: settlementSummary,
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      mode,
      campaignId: campaign.id,
      eligibleChannels: eligibleChannels.length,
      attempted,
      posted,
      failed,
      skipped,
      deleteSummary,
      settlementSummary,
      failedChannels,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    console.error("Admin Emergency Push Error:", error);
    return NextResponse.json({
      error: "Emergency push failed before completion.",
      reason: message,
      failedChannels: [],
    }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
