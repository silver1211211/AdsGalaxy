import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { claimAdvertiserDirectDebit } from "@/lib/advertiserDirectDebit";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { campaignCategoryMatches } from "@/lib/campaignCategories";
import { channelCampaignMatchesInventory } from "@/lib/channelAudience";
import { deleteCampaignPostsByIds, type CampaignPostDeletionSummary } from "@/lib/campaignPostDeletion";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { settleChannelCampaigns } from "@/lib/channelSettlement";
import { acquireCronLock, releaseCronLock } from "@/lib/cronSecurity";
import { sendTelegramMessage } from "@/lib/telegram";
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
import { composeCampaignCreativeTelegramHtml } from "@/lib/campaignCreative";
import { campaignExcludesChannel, campaignExcludesIdentifier, loadCampaignExclusions } from "@/lib/campaignInventoryExclusions";
import { calculateBroadcastPayout, getBroadcastPayoutSettings, type BroadcastPayout, type BroadcastPayoutSettings } from "@/lib/broadcastPublisherCpmEngine";
import { processBoundedQueue } from "@/lib/concurrency";
import { effectiveBidPerThousand, getAdvertiserDiscount } from "@/lib/advertiserDiscount";
import { isCampaignDeliveryAllowed, isChannelAllowedForCampaign, mainCampaignScopeSql, recordSilverAudit, requireSilverAdmin, silverCampaignScopeSql } from "@/lib/silverCampaignControl";
import { releaseChannelScheduleSlotClaim, reserveChannelPlacement, restoreReplacedChannelScheduleSlotClaim, trackedChannelCtaUrl, trackedGrowthCtaUrl } from "@/lib/channelDelivery";
import { reconcileChannelDailyCapLifecycle } from "@/lib/channelDailyCap";
import { resolveCampaignPublicId } from "@/lib/campaignIdentity";
import { selectEmergencyScheduleSlot } from "@/lib/channelScheduleSlots";
import { refreshChannelViews } from "@/lib/channelAdminViewRefresh";
import { requireAdServingAllowed } from "@/lib/productionSafety";
import { classifyTelegramAccessFailure, verifyTelegramChannelAccess } from "@/lib/telegramChannelAccess";
import { checkChannelPlacementAffordability } from "@/lib/channelPlacementAffordability";
import { createGrowthDeliveryInvite } from "@/lib/channelGrowthInvite";

export const dynamic = "force-dynamic";

const VALID_MODES = new Set(["fill_empty_slots", "replace_everything"]);

type EmergencyMode = "fill_empty_slots" | "replace_everything";

function parseEmergencyBroadcastLimit(body: Record<string, unknown>) {
  if (body.send_all === true) return { ok: true as const, limit: null, sendAll: true };
  const requested = Number(body.recipient_count);
  if (!Number.isSafeInteger(requested) || requested < 1) {
    return { ok: false as const, error: "Recipient count must be a positive whole number" };
  }
  return { ok: true as const, limit: requested, sendAll: false };
}

type CampaignRow = RowDataPacket & {
  id: number;
  public_id?: number;
  channel_delivery_generation?: number;
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
  cpm: string | number;
  effective_cpm?: number;
  campaign_kind?: string;
  destination_chat_id?: string | number | null;
  destination_channel_id?: string | number | null;
  countries?: string | string[] | null;
  languages?: string | string[] | null;
  start_at?: string | Date | null;
  end_at?: string | Date | null;
};

type ChannelRow = RowDataPacket & {
  id: number;
  user_id: number;
  chat_id: string;
  username: string;
  invite_link_hash?: string | null;
  categories: string | string[] | null;
  audience_continents: string | string[] | null;
  posts_per_day: number;
  posting_times?: string | string[] | null;
  scheduler_slot?: string | null;
  authoritative_country_code?: string | null;
  authoritative_language_code?: string | null;
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
  hasDeliveryReserveAmount: boolean;
  hasDeliveryPlatformRevenue: boolean;
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

type TelegramSendResponse = {
  ok?: boolean;
  description?: string;
  result?: {
    message_id?: number;
  };
  parameters?: {
    retry_after?: number;
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
        OR (TABLE_NAME = 'broadcast_deliveries' AND COLUMN_NAME IN ('status', 'cost', 'publisher_reward', 'reserve_amount', 'platform_revenue', 'retry_count', 'last_success_at', 'last_failure_at', 'failure_reason', 'telegram_error'))
      )
  `);

  const columns = new Set(rows.map((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));

  return {
    hasBotUserChatId: columns.has("bot_users.chat_id"),
    hasDeliveryStatus: columns.has("broadcast_deliveries.status"),
    hasDeliveryCost: columns.has("broadcast_deliveries.cost"),
    hasDeliveryPublisherReward: columns.has("broadcast_deliveries.publisher_reward"),
    hasDeliveryReserveAmount: columns.has("broadcast_deliveries.reserve_amount"),
    hasDeliveryPlatformRevenue: columns.has("broadcast_deliveries.platform_revenue"),
    hasDeliveryRetryCount: columns.has("broadcast_deliveries.retry_count"),
    hasDeliverySuccessAt: columns.has("broadcast_deliveries.last_success_at"),
    hasDeliveryFailureAt: columns.has("broadcast_deliveries.last_failure_at"),
    hasDeliveryFailureReason: columns.has("broadcast_deliveries.failure_reason"),
    hasDeliveryTelegramError: columns.has("broadcast_deliveries.telegram_error"),
  };
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

async function getEligibleChannels(campaign: CampaignRow, mode: EmergencyMode, followRules: boolean) {
  const dailyCapCondition = mode === "fill_empty_slots"
    ? `AND (
        SELECT COUNT(*) FROM campaign_posts daily_cp
        WHERE daily_cp.channel_id = c.id
          AND daily_cp.created_at >= UTC_DATE()
          AND daily_cp.created_at < DATE_ADD(UTC_DATE(), INTERVAL 1 DAY)
          AND daily_cp.status IN ('active','posted','sent','deleted','already_missing')
          AND daily_cp.delivery_confirmed_at IS NOT NULL
          AND daily_cp.delivery_failed_at IS NULL
      ) < GREATEST(COALESCE(c.posts_per_day, 1), 1)`
    : "";
  const campaignCooldownCondition = mode === "fill_empty_slots" && followRules
    ? `AND NOT EXISTS (
        SELECT 1 FROM campaign_posts same_campaign
        WHERE same_campaign.channel_id = c.id
          AND same_campaign.campaign_id = ?
          AND same_campaign.status IN ('active','posted','sent','replaced','deleted','already_missing')
          AND same_campaign.delivery_confirmed_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
          AND same_campaign.delivery_failed_at IS NULL
      )`
    : "";

  const [inventoryRows] = await pool.query<Array<RowDataPacket & {
    active_inventory: number | string;
    exempt_channels: number | string;
    inaccessible_channels: number | string;
  }>>(`
    SELECT COUNT(*) active_inventory,
      SUM(EXISTS(SELECT 1 FROM silver_ad_exempt_users seu WHERE seu.user_id=c.user_id AND seu.active=1)) exempt_channels,
      SUM((c.chat_id IS NULL OR c.chat_id='') AND NOT EXISTS(SELECT 1 FROM silver_ad_exempt_users seu WHERE seu.user_id=c.user_id AND seu.active=1)) inaccessible_channels
    FROM channels c
    WHERE c.status='active' AND c.is_deleted=FALSE
  `);

  const advertiserOwnerCondition = "AND c.user_id != ?";
  const queryParams: Array<number | string | string[]> = [];
  queryParams.push(campaign.user_id);
  queryParams.push(campaign.id);
  if (mode === "fill_empty_slots" && followRules) queryParams.push(campaign.id);

  const [channels] = await pool.query<ChannelRow[]>(`
    SELECT c.*,g.authoritative_country_code,g.authoritative_language_code
    FROM channels c
    LEFT JOIN channel_geo_classifications g ON g.channel_id=c.id
    WHERE c.status = 'active'
      AND c.is_deleted = FALSE
      ${advertiserOwnerCondition}
      AND NOT EXISTS (SELECT 1 FROM campaign_admin_isolation cai JOIN silver_ad_exempt_users seu ON seu.user_id=c.user_id AND seu.active=1 WHERE cai.campaign_id=? AND cai.management_scope='silver')
      AND c.chat_id IS NOT NULL
      AND c.chat_id != ''
      ${dailyCapCondition}
      ${campaignCooldownCondition}
    ORDER BY c.id ASC
  `, queryParams);

  const channelExclusions = await loadCampaignExclusions(pool, "campaign", [Number(campaign.id)], "channel");
  const eligibleChannels = channels.filter((channel) => {
    if (campaignExcludesChannel(channelExclusions, Number(campaign.id), channel)) return false;
    return channelCampaignMatchesInventory({
      campaignCategory: campaign.category,
      campaignAudience: campaign.continents,
      channelCategories: channel.categories,
      channelAudience: channel.audience_continents,
      campaignCountries: campaign.countries,
      campaignLanguages: campaign.languages,
      channelCountry: channel.authoritative_country_code,
      channelLanguage: channel.authoritative_language_code,
    });
  });

  return {
    eligibleChannels,
    skippedByExclusion: channels.length - eligibleChannels.length,
    skippedByLimit: 0,
    activeInventorySnapshot: Number(inventoryRows[0]?.active_inventory || 0),
    exemptChannels: Number(inventoryRows[0]?.exempt_channels || 0),
    inaccessibleChannels: Number(inventoryRows[0]?.inaccessible_channels || 0),
  };
}

async function postCampaignToChannel(options: {
  campaign: CampaignRow;
  channel: ChannelRow;
  schema: EmergencySchema;
  requestOrigin: string;
  mode: EmergencyMode;
  silverOverride: boolean;
  scheduleSlot: {
    slotDate: string; slotTime: string; replacesPostId: number | null;
    victimCampaignId?: number; victimGeneration?: number;
    victimClaimType?: "scheduled" | "emergency_fill" | "emergency_replace";
  };
}) {
  const { campaign, channel, schema, requestOrigin, mode, scheduleSlot, silverOverride } = options;
  const silverEligibility = await isChannelAllowedForCampaign(Number(campaign.id), Number(channel.id));
  if (!silverEligibility.allowed) return { ok: false, skipped: true, retryAttempted: false, reason: silverEligibility.reason || "silver_delivery_blocked" };
  const health = await verifyTelegramChannelAccess({
    channelId:channel.id,chatId:channel.chat_id,username:channel.username,
    source:"emergency_push",persist:true,autoPauseActive:true,
  });
  if (!health.ok) return { ok:false,skipped:true,retryAttempted:false,reason:`telegram_unhealthy_${health.state}`,autoPaused:health.permanent };

  const reservationConnection=await pool.getConnection();
  let reservation;
  let generation=1;
  try {
    await reservationConnection.beginTransaction();
    const affordability=await checkChannelPlacementAffordability(reservationConnection,Number(campaign.id));
    if (!affordability.allowed) {
      await reservationConnection.rollback();
      return {ok:false,skipped:true,retryAttempted:false,reason:affordability.reason,stopReason:affordability.reason};
    }
    // Emergency attempts use the next generation, but the campaign generation
    // is finalized only after Telegram confirms at least one delivery.
    generation=affordability.generation+1;
    reservation=await reserveChannelPlacement(reservationConnection,{
      campaignId:Number(campaign.id),channelId:Number(channel.id),channelUsername:channel.username,
      generation,mode:"emergency",
      postingSlotDate:schema.hasPostSlotColumns?scheduleSlot.slotDate:undefined,
      postingSlotTime:schema.hasPostSlotColumns?scheduleSlot.slotTime:undefined,
      claimType:mode === "fill_empty_slots" ? "emergency_fill" : "emergency_replace",
      replacesPostId:scheduleSlot.replacesPostId,
      capacityLimit:mode === "fill_empty_slots"?Math.max(1,Number(channel.posts_per_day||1)):undefined,
    });
    if (reservation.claimed) await reservationConnection.commit(); else await reservationConnection.rollback();
  } catch (error) {
    await reservationConnection.rollback();
    throw error;
  } finally { reservationConnection.release(); }

  if (!reservation.claimed) {
    return { ok:false,skipped:true,retryAttempted:false,reason:reservation.reason || "delivery_claim_exists",reservationConflict:true };
  }

  const postId = reservation.postId;
  const failReservation=async(reason:string)=>{
    const conn=await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("UPDATE campaign_posts SET status='delivery_failed',delivery_failed_at=NOW(),delivery_failure_reason=? WHERE id=? AND delivery_confirmed_at IS NULL",[reason.slice(0,255),postId]);
      let released=false;
      if(scheduleSlot.replacesPostId&&reservation.slotClaimTransferred){
        released=await restoreReplacedChannelScheduleSlotClaim(conn,{
          claimId:Number(reservation.slotClaimId),replacementPostId:postId,victimPostId:Number(scheduleSlot.replacesPostId),
          victimCampaignId:Number(scheduleSlot.victimCampaignId),victimGeneration:Number(scheduleSlot.victimGeneration||1),
          victimClaimType:scheduleSlot.victimClaimType||"scheduled",
        });
      }else if(reservation.slotClaimId){
        released=await releaseChannelScheduleSlotClaim(conn,{claimId:Number(reservation.slotClaimId),postId,channelId:Number(channel.id),slotDate:scheduleSlot.slotDate,slotTime:scheduleSlot.slotTime});
      }
      await conn.commit();
      return released;
    }catch(error){await conn.rollback();throw error;}finally{conn.release();}
  };

  let replacementSettlement: {settledPosts:number;advertiserDebited:number;publisherCredited:number}|null=null;
  if(scheduleSlot.replacesPostId){
    const [[victim]]=await pool.query<Array<RowDataPacket & {campaign_id:number}>>(
      "SELECT campaign_id FROM campaign_posts WHERE id=? AND channel_id=? AND status IN ('active','posted','sent') AND deleted_at IS NULL AND delivery_confirmed_at IS NOT NULL FOR UPDATE",
      [scheduleSlot.replacesPostId,channel.id],
    );
    if(!victim){
      const claimReleased=await failReservation("replacement_victim_changed");
      return {ok:false,skipped:true,retryAttempted:false,postId,reason:"replacement_victim_changed",claimReleased};
    }
    try{
      await refreshChannelViews(Number(channel.id),50);
      const settlement=await settleChannelCampaigns({campaignId:Number(victim.campaign_id),skipGlobalMaintenance:true,campaignStatuses:["active","paused"]});
      if(settlement.failedPosts>0){
        const claimReleased=await failReservation("replacement_victim_settlement_failed");
        return {ok:false,skipped:true,retryAttempted:false,postId,reason:"replacement_victim_settlement_failed",claimReleased,settlementFailed:true};
      }
      replacementSettlement={settledPosts:settlement.settledPosts,advertiserDebited:settlement.advertiserDebited,publisherCredited:settlement.publisherCredited};
    }catch(error){
      const text=error instanceof Error?error.message:String(error);
      const retryable=/ER_LOCK_DEADLOCK|40001|deadlock/i.test(text);
      const claimReleased=await failReservation(retryable?"victim_settlement_retryable_failure":"replacement_victim_settlement_failed");
      return {ok:false,skipped:true,retryAttempted:false,postId,reason:retryable?"victim_settlement_retryable_failure":"replacement_victim_settlement_failed",claimReleased,settlementFailed:true,settlementRetryable:retryable};
    }
  }

  const domain = process.env.DOMAIN;
  const host = domain ? `https://${domain}` : (process.env.NEXT_PUBLIC_APP_URL || requestOrigin);
  let buttonUrl = trackedChannelCtaUrl(host,Number(campaign.public_id||campaign.id),postId);
  if(campaign.campaign_kind==="channel_growth"){
    try{
      await createGrowthDeliveryInvite({campaignId:Number(campaign.id),postId,sourceChannelId:Number(channel.id),sourcePublisherId:Number(channel.user_id),destinationChatId:Number(campaign.destination_chat_id),destinationChannelId:campaign.destination_channel_id?Number(campaign.destination_channel_id):null});
      buttonUrl=trackedGrowthCtaUrl(host,Number(campaign.public_id||campaign.id),postId);
    }catch{
      const claimReleased=await failReservation("growth_invite_unavailable");
      return {ok:false,skipped:true,retryAttempted:false,postId,reason:"growth_invite_unavailable",claimReleased};
    }
  }
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || process.env.NEXT_PUBLIC_BOT_USERNAME || "Ads_Galaxy_bot";

  const replyMarkup = {
    inline_keyboard: [
      [{ text: campaign.button_text, url: buttonUrl }],
      [{ text: "Advertise with Ads galaxy", url: `https://t.me/${botUsername}?start=advertise` }],
    ],
  };

  const finalEligibility = await isChannelAllowedForCampaign(Number(campaign.id), Number(channel.id));
  if (!finalEligibility.allowed) {
    const reason = finalEligibility.reason || "silver_delivery_blocked";
    const claimReleased=await failReservation(reason);
    return { ok: false, skipped: true, retryAttempted: false, postId, reason,claimReleased };
  }

  const send = async ():Promise<TelegramSendResponse|undefined> => {
    try{
      return await sendTelegramMessage(channel.chat_id, composeCampaignCreativeTelegramHtml(campaign.campaign_title, campaign.message_text), {
        photo: campaign.image_url,
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      }) as TelegramSendResponse|undefined;
    }catch(error){
      return {ok:false,description:error instanceof Error?error.message:"Telegram send failed"};
    }
  };
  let result = await send();
  let retryAttempted = false;
  let failure = result?.ok ? null : classifyTelegramAccessFailure({description:result?.description,retryAfterSeconds:result?.parameters?.retry_after});
  // Undefined is an ambiguous transport outcome and must not be retried blindly.
  if (result && !result.ok && failure?.retryable) {
    const retryAfter = Math.max(0, Number(result.parameters?.retry_after || 0));
    // Never violate a long Telegram flood wait merely to keep this HTTP request open.
    if (retryAfter <= 30) {
      if (retryAfter) await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      const retryEligibility = await isChannelAllowedForCampaign(Number(campaign.id), Number(channel.id));
      if (retryEligibility.allowed) {
        retryAttempted = true;
        result = await send();
        failure=result?.ok?null:classifyTelegramAccessFailure({description:result?.description,retryAfterSeconds:result?.parameters?.retry_after});
      }
    }
  }

  if (result?.ok && result.result?.message_id) {
    const [confirmed]=await pool.query<ResultSetHeader>(
      schema.hasDeliveryConfirmedAtColumn
        ? "UPDATE campaign_posts SET status='active', message_id = ?, delivery_confirmed_at = NOW() WHERE id = ? AND status='pending_delivery'"
        : "UPDATE campaign_posts SET status='active', message_id = ? WHERE id = ?",
      [result.result.message_id, postId]
    );
    if(confirmed.affectedRows!==1){
      return {ok:false,skipped:false,retryAttempted,postId,reason:"delivery_confirmation_not_persisted",messageId:result.result.message_id};
    }
    await pool.query("UPDATE campaigns SET channel_delivery_generation=GREATEST(channel_delivery_generation,?) WHERE id=?",[generation,campaign.id]);
    await recordDeliveryEvent(schema.hasCampaignDeliveryEvents, campaign.id, channel.id, postId, "emergency_posted", {
      mode: "emergency_push",
    });
    let replacementDeletion:CampaignPostDeletionSummary|null=null;
    let partial=false;
    let victimAlreadyMissing=false;
    if(scheduleSlot.replacesPostId){
      replacementDeletion=await deleteCampaignPostsByIds([scheduleSlot.replacesPostId],silverOverride?{requiredSilverExemptUserId:true}:{});
      await pool.query("UPDATE campaign_posts SET status='replaced' WHERE id=? AND delivery_confirmed_at IS NOT NULL",[scheduleSlot.replacesPostId]);
      victimAlreadyMissing=Boolean(replacementDeletion.details.some(detail=>detail.already_deleted));
      partial=replacementDeletion.deleted!==1;
    }
    return {ok:true,retryAttempted,postId,messageId:result.result.message_id,replacementSettlement,replacementDeletion,partial,victimAlreadyMissing};
  }

  const claimReleased=await failReservation(String(result?.description||"Telegram send failed"));
  if(failure?.permanent){
    await verifyTelegramChannelAccess({channelId:channel.id,chatId:channel.chat_id,username:channel.username,source:"telegram_send",persist:true,autoPauseActive:true});
  }
  await recordDeliveryEvent(schema.hasCampaignDeliveryEvents, campaign.id, channel.id, postId, "emergency_send_failed", {
    reason: result?.description || "Telegram send failed",
  });

  return { ok: false, retryAttempted, postId, reason: failure?.reasonCode || "telegram_send_failed",claimReleased,autoPaused:Boolean(failure?.permanent) };
}

async function getEligibleBroadcastDispatches(campaign: CampaignRow, schema: BroadcastSchema) {
  const [bots] = await pool.query<BotRow[]>(`
    SELECT *
    FROM bots
    WHERE status = 'active'
      AND is_deleted = FALSE
      AND COALESCE(health_status, 'active') IN ('active', 'healthy')
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
    const chatIdExpression = schema.hasBotUserChatId ? "bu.chat_id" : "bu.user_id";
      const [users] = await pool.query<BroadcastUserRow[]>(`
        SELECT bu.id, ${chatIdExpression} as chat_id
        FROM bot_users bu
        JOIN bots b ON b.id = bu.bot_id
        WHERE bu.bot_id = ?
        AND ${botUserBroadcastEligibleCondition("bu", "b")}
      ORDER BY CASE WHEN bu.status='active' THEN 0 ELSE 1 END, bu.id ASC
    `, [bot.id]);

    for (const user of users) {
      dispatches.push({ bot, user });
    }
  }

  return {
    dispatches,
    skippedByExclusion: healthyBots.length - exclusionFilteredBots.length,
  };
}

function requireBillableBroadcastSchema(schema: BroadcastSchema) {
  if (!schema.hasDeliveryStatus || !schema.hasDeliveryCost || !schema.hasDeliveryPublisherReward || !schema.hasDeliveryReserveAmount || !schema.hasDeliveryPlatformRevenue) {
    throw new Error("broadcast_billing_schema_missing");
  }
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
  campaignId: number;
  payout: BroadcastPayout;
  attempts: number;
}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [deliveryRows] = await conn.query<Array<RowDataPacket & { advertiser_id: number; funding_model: string; cost: string | number }>>(
      "SELECT c.user_id advertiser_id,c.funding_model,bd.cost FROM broadcast_deliveries bd JOIN campaigns c ON c.id=bd.campaign_id WHERE bd.id=? FOR UPDATE",
      [input.deliveryId],
    );
    const delivery = deliveryRows[0];
    if (!delivery) throw new Error("broadcast_reservation_missing");
    if (delivery.funding_model === "direct_debit") {
      const walletDebit = await claimAdvertiserDirectDebit(conn, {
        sourceKey: `bot:delivery:${input.deliveryId}`,
        advertiserId: Number(delivery.advertiser_id), campaignId: input.campaignId,
        campaignTable: "campaigns", billingType: "bot_delivery", amount: input.payout.advertiserDebit,
        description: `Bot delivery charge #${input.deliveryId}`,
      });
      if (!walletDebit.ok) {
        if (walletDebit.duplicate) { await conn.rollback(); return { ok: true, idempotent: true }; }
        await conn.query("UPDATE campaigns SET budget=budget+?,status='paused',pause_reason='insufficient_balance' WHERE id=?", [delivery.cost,input.campaignId]);
        await conn.query("UPDATE broadcast_deliveries SET cost=0,publisher_reward=0,reserve_amount=0,platform_revenue=0,status='failed' WHERE id=?", [input.deliveryId]);
        await conn.commit();
        return { ok: false, reason: "insufficient_balance" };
      }
    }
  const assignments = ["publisher_reward=?", "reserve_amount=?", "platform_revenue=?", "status='sent'"];
  const params: Array<number | string> = [input.payout.publisherReward, input.payout.reserveAmount, input.payout.platformRevenue];
  if (input.schema.hasDeliveryRetryCount) {
    assignments.push("retry_count=?");
    params.push(input.attempts);
  }
  if (input.schema.hasDeliverySuccessAt) assignments.push("last_success_at=NOW()");
  if (input.schema.hasDeliveryFailureReason) assignments.push("failure_reason=NULL");
  if (input.schema.hasDeliveryTelegramError) assignments.push("telegram_error=NULL");
  params.push(input.deliveryId);

  const [updated] = await conn.query<ResultSetHeader>(
    `UPDATE broadcast_deliveries SET ${assignments.join(",")} WHERE id=? AND status='pending'`,
    params
  );
  if (updated.affectedRows !== 1) throw new Error("broadcast_finalize_race");
  await conn.commit();
  return { ok: true, idempotent: false };
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally { conn.release(); }
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
    const assignments = ["cost=0", "publisher_reward=0", "reserve_amount=0", "platform_revenue=0", "status='failed'"];
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
  payoutSettings: BroadcastPayoutSettings;
}) {
  const { campaign, bot, user, schema } = options;
  const replyMarkup = {
    inline_keyboard: [[
      { text: campaign.button_text, url: campaign.link },
    ]],
  };
  const payout = calculateBroadcastPayout(campaign.effective_cpm ?? campaign.cpm, options.payoutSettings);
  const cost = payout.advertiserDebit;
  const reservation = await reserveEmergencyBroadcastDelivery({ schema, campaign, bot, user, cost });
  if (!reservation.ok) return { ok: false, reason: reservation.reason };

  let sendResult;
  try {
    sendResult = await sendWithRetries(() => sendTelegramMessage(user.chat_id, composeCampaignCreativeTelegramHtml(campaign.campaign_title, campaign.message_text), {
      photo: campaign.image_url,
      parse_mode: "HTML",
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
    const finalized = await finalizeEmergencyBroadcastDelivery({
      schema,
      deliveryId: reservation.deliveryId,
      campaignId: campaign.id,
      payout,
      attempts: sendResult.attempts || 1,
    });
    if (!finalized.ok) return { ok: false, reason: finalized.reason };
    await pool.query("UPDATE bot_users SET last_broadcast_at = NOW() WHERE id = ?", [user.id]);
    await markBotUserDeliverySuccess(user.id);
    await recordBotBroadcastSuccess(bot.id);
    if (reservation.remainingBudget <= 0) {
      await pool.query(
        "UPDATE campaigns SET status='budget_exhausted',budget=0,budget_exhausted_at=NOW(),pause_reason='budget_exhausted' WHERE id=? AND status='active'",
        [campaign.id]
      );
    }
    return { ok: true, cost, reward: payout.publisherReward, remainingBudget: reservation.remainingBudget };
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

async function emergencyPushBroadcast(campaign: CampaignRow, mode: EmergencyMode, deliveryLimit: number | null, sendAll: boolean, auditRecorder: typeof recordAdminActionAudit) {
  const schema = await getBroadcastSchema();
  requireBillableBroadcastSchema(schema);
  const payoutSettings = await getBroadcastPayoutSettings();
  const eligible = await getEligibleBroadcastDispatches(campaign, schema);
  if (deliveryLimit !== null && deliveryLimit > eligible.dispatches.length) {
    return NextResponse.json({
      error: `Requested ${deliveryLimit.toLocaleString()} broadcasts, but only ${eligible.dispatches.length.toLocaleString()} active eligible bot users are available.`,
      eligibleBotUsers: eligible.dispatches.length,
    }, { status: 400 });
  }
  const dispatches = deliveryLimit === null ? eligible.dispatches : eligible.dispatches.slice(0, deliveryLimit);
  const failedUsers: Array<{ botId: number; userId: number; reason: string }> = [];
  let attempted = 0;
  let posted = 0;

  const requestedWorkers = Number.parseInt(process.env.EMERGENCY_BROADCAST_WORKERS || "20", 10);
  const workerCount = Math.min(50, Math.max(1, Number.isFinite(requestedWorkers) ? requestedWorkers : 20));
  const results = await processBoundedQueue(dispatches, workerCount, async (dispatch) => {
    try {
      const result = await postBroadcastToBotUser({
        campaign,
        bot: dispatch.bot,
        user: dispatch.user,
        schema,
        payoutSettings,
      });

      if (result.ok) {
        return { ok: true as const };
      } else {
        return { ok: false as const, botId: dispatch.bot.id, userId: dispatch.user.id, reason: result.reason || "Telegram send failed" };
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Emergency broadcast failed";
      return { ok: false as const, botId: dispatch.bot.id, userId: dispatch.user.id, reason: message };
    }
  });
  attempted = results.length;
  posted = results.filter((result) => result.ok).length;
  failedUsers.push(...results.filter((result) => !result.ok).map((result) => ({ botId: result.botId, userId: result.userId, reason: result.reason })));

  const failed = failedUsers.length;
  const skipped = Math.max(0, eligible.dispatches.length - dispatches.length) + eligible.skippedByExclusion;

  await auditRecorder({
    action: "emergency_push",
    entityType: "campaign",
    entityId: campaign.id,
    reason: mode,
    metadata: {
      public_campaign_id: Number(campaign.public_id || campaign.id),
      mode,
      delivery_type: "broadcast",
      send_all: sendAll,
      requested_recipient_count: sendAll ? null : deliveryLimit,
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
    campaignId: Number(campaign.public_id || campaign.id),
    internalCampaignId: campaign.id,
    deliveryType: "broadcast",
    sendAll,
    requestedRecipientCount: sendAll ? null : deliveryLimit,
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

export async function handleCampaignEmergencyPush(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  managementScope: "main" | "silver" = "main"
) {
  const operationId=randomUUID();
  const operationStartedAt=new Date();
  const { admin, response } = managementScope === "silver" ? await requireSilverAdmin() : await requireAdminPermission("dangerous");
  if (response) return response;
  let publicCampaignId: number | null = null;
  const recordScopedAudit = async (input: Parameters<typeof recordAdminActionAudit>[0]) => {
    input.metadata = { ...(input.metadata as Record<string, unknown> | undefined), public_campaign_id: publicCampaignId };
    if (managementScope === "silver") {
      await recordSilverAudit({ adminId: admin?.id, action: input.action, campaignId: Number(input.entityId), metadata: input.metadata as Record<string, unknown> | undefined });
      return;
    }
    await recordAdminActionAudit(input);
  };

  const { id: requestedId } = await params;
  const identity = managementScope === "main" ? await resolveCampaignPublicId(Number(requestedId)) : { id: Number(requestedId) };
  if (!identity) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  publicCampaignId = managementScope === "main" ? Number(requestedId) : Number(identity.id);
  const id = String(identity.id);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const mode = body.mode as EmergencyMode;
  const silverOverride = managementScope === "silver";
  const followRules = body.ignore_rules !== true;

  if (!VALID_MODES.has(mode)) {
    return NextResponse.json({ error: "Invalid emergency push mode" }, { status: 400 });
  }

  if (mode === "replace_everything" && body.confirmation !== "CONFIRM") {
    return NextResponse.json({ error: "Type CONFIRM to run Replace Everything" }, { status: 400 });
  }

  let lock: { lockName: string; ownerToken: string } | null = null;
  try {
    lock = await acquireCronLock(`campaign-management-${id}`, 7200);
    if (!lock) {
      return NextResponse.json({
        error: "Emergency push is already running for this campaign. Please wait for it to finish.",
      }, { status: 409 });
    }

    // Use the same UTC billing-day lifecycle as normal channel delivery before
    // Emergency Push evaluates campaign eligibility.
    await reconcileChannelDailyCapLifecycle();
    const servingBlocked=await requireAdServingAllowed();
    if(servingBlocked) return servingBlocked;

    const scopePredicate = managementScope === "silver" ? silverCampaignScopeSql("c") : mainCampaignScopeSql("c");
    const [campaignRows] = await pool.query<CampaignRow[]>(`SELECT c.* FROM campaigns c JOIN users u ON u.id=c.user_id WHERE c.id = ? AND ${scopePredicate} AND COALESCE(u.advertiser_trust_level,'new')!='restricted'`, [id]);

    if (campaignRows.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const campaign = campaignRows[0] as CampaignRow;
    if (silverOverride) {
      const delivery = await isCampaignDeliveryAllowed(Number(campaign.id));
      if (!delivery.allowed) {
        return NextResponse.json({ error: "Silver delivery is paused", reason: delivery.reason }, { status: 409 });
      }
    }
    const advertiserDiscount = await getAdvertiserDiscount(pool, campaign.user_id);
    campaign.effective_cpm = effectiveBidPerThousand(campaign.cpm, advertiserDiscount.cpm_discount);

    if (campaign.status !== "active") {
      return NextResponse.json({ error: "Only active campaigns can be emergency pushed" }, { status: 400 });
    }
    const now=Date.now();
    if((campaign.start_at&&new Date(campaign.start_at).getTime()>now)||(campaign.end_at&&new Date(campaign.end_at).getTime()<now)){
      return NextResponse.json({success:false,status:"BLOCKED",error:"Campaign is outside its delivery dates"},{status:409});
    }

    if (parseFloat(String(campaign.budget || "0")) <= 0) {
      return NextResponse.json({ error: "Campaign budget must be greater than 0" }, { status: 400 });
    }

    if (!campaign.message_text || !campaign.button_text || !campaign.link) {
      return NextResponse.json({ error: "Campaign must have message text, button text, and link before emergency push" }, { status: 400 });
    }

    if (campaign.type === "broadcast") {
      const selection = parseEmergencyBroadcastLimit(body);
      if (!selection.ok) return NextResponse.json({ error: selection.error }, { status: 400 });
      return emergencyPushBroadcast(campaign, mode, selection.limit, selection.sendAll, recordScopedAudit);
    }

    const schema = await getEmergencySchema();
    let settlementSummary: Record<string, number> | null = null;
    let deleteSummary: CampaignPostDeletionSummary | null = null;
    const {
      eligibleChannels,
      skippedByLimit,
      skippedByExclusion,
      activeInventorySnapshot,
      exemptChannels,
      inaccessibleChannels,
    } = await getEligibleChannels(campaign, mode, followRules);

    const requestedWorkers = silverOverride
      ? Number.parseInt(process.env.SILVER_EMERGENCY_CHANNEL_WORKERS || "4", 10)
      : 1;
    const workerCount = Math.min(10, Math.max(1, Number.isFinite(requestedWorkers) ? requestedWorkers : 4));
    const results = await processBoundedQueue(eligibleChannels, workerCount, async (channel) => {
      try {
        const scheduleSlot = await selectEmergencyScheduleSlot(pool, {
          channel,
          mode,
          bypassTiming: !followRules,
        });
        if (!scheduleSlot) {
          return { ok: false as const, skipped: true, retryAttempted: false, channelId: channel.id, reason: "no_eligible_publisher_schedule_slot" };
        }

        const result = await postCampaignToChannel({
          campaign,
          channel,
          schema,
          requestOrigin: new URL(request.url).origin,
          mode,
          silverOverride,
          scheduleSlot,
        });
        return { ...result, channelId: channel.id, replacementVictim:Boolean(scheduleSlot.replacesPostId) };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Emergency post failed";
        console.warn("Emergency push channel processing failed", {
          campaign_id: campaign.id,
          channel_id: channel.id,
          reason: message,
        });
        return { ok: false as const, skipped: false, retryAttempted: false, channelId: channel.id, reason: message };
      }
    });

    const attempted = results.filter(result => !result.skipped).length;
    const posted = results.filter(result => result.ok).length;
    const retryAttempted = results.filter(result => result.retryAttempted).length;
    const finalFailed = results.filter(result => !result.ok && !result.skipped).length;
    const skipped = skippedByLimit + skippedByExclusion + results.filter(result => result.skipped).length;
    const failed = finalFailed;
    const partialPlacements=results.filter(result=>result.ok&&"partial" in result&&result.partial).length;
    const replacementResults = results.filter((result) => result.ok && "replacementSettlement" in result && result.replacementSettlement && result.replacementDeletion);
    if (replacementResults.length) {
      settlementSummary = replacementResults.reduce((summary, result) => ({
        settledPosts: summary.settledPosts + Number("replacementSettlement" in result ? result.replacementSettlement?.settledPosts || 0 : 0),
        advertiserDebited: summary.advertiserDebited + Number("replacementSettlement" in result ? result.replacementSettlement?.advertiserDebited || 0 : 0),
        publisherCredited: summary.publisherCredited + Number("replacementSettlement" in result ? result.replacementSettlement?.publisherCredited || 0 : 0),
      }), { settledPosts: 0, advertiserDebited: 0, publisherCredited: 0 });
      deleteSummary = replacementResults.reduce((summary, result) => {
        const deletion = ("replacementDeletion" in result ? result.replacementDeletion : null)!;
        summary.checked += deletion.checked;
        summary.total += deletion.total;
        summary.deleted += deletion.deleted;
        summary.failed += deletion.failed;
        summary.retry += deletion.retry;
        summary.skipped += deletion.skipped;
        summary.failedIds.push(...deletion.failedIds);
        summary.details.push(...deletion.details);
        if (deletion.classifications) {
          for (const key of Object.keys(summary.classifications) as Array<keyof typeof summary.classifications>) {
            summary.classifications[key] += deletion.classifications[key];
          }
        }
        return summary;
      }, {
        checked: 0, total: 0, deleted: 0, failed: 0, retry: 0, skipped: 0, failedIds: [], details: [],
        classifications: { attempted: 0, deleted: 0, already_missing: 0, terminal: 0, access_lost: 0, temporary: 0, deferred: 0 },
      } as CampaignPostDeletionSummary);
    }
    const failedChannels = results
      .filter(result => !result.ok)
      .map(result => ({ channelId: result.channelId, reason: result.reason || "Telegram send failed", result:String(result.reason||"TELEGRAM_SEND_FAILED").toUpperCase() }));
    const permissionFailures = failedChannels.filter(channel => /forbidden|rights|member|kicked|chat not found/i.test(channel.reason)).length;
    const claimReleases=results.filter(result=>"claimReleased" in result&&result.claimReleased).length;
    const reservationConflicts=results.filter(result=>"reservationConflict" in result&&result.reservationConflict).length;
    const autoPausedChannels=results.filter(result=>"autoPaused" in result&&result.autoPaused).length;
    const stopResult=results.find(result=>"stopReason" in result&&Boolean(result.stopReason));
    const stopReason=stopResult&&"stopReason" in stopResult?stopResult.stopReason:null;
    const operationStatus=posted===0?"NO_DELIVERY":(failed>0||skipped>0||partialPlacements>0?"PARTIAL_SUCCESS":"SUCCESS");
    const failureReasonCounts=failedChannels.reduce<Record<string,number>>((counts,item)=>{counts[item.reason]=(counts[item.reason]||0)+1;return counts;},{});

    await recordScopedAudit({
      action: "emergency_push",
      entityType: "campaign",
      entityId: campaign.id,
      reason: mode,
      metadata: {
        mode,
        operation_id:operationId,
        follow_rules: followRules,
        eligible_channels: eligibleChannels.length,
        attempted,
        success: posted,
        failed,
        skipped,
        active_inventory_snapshot: activeInventorySnapshot,
        exempt_channels: exemptChannels,
        inaccessible_no_permission_channels: inaccessibleChannels + permissionFailures,
        retry_attempted: retryAttempted,
        final_failed: finalFailed,
        delete_summary: deleteSummary,
        settlement_summary: settlementSummary,
        timestamp: new Date().toISOString(),
        duration_ms:Date.now()-operationStartedAt.getTime(),
        operation_status:operationStatus,
        failure_reason_counts:failureReasonCounts,
        bypass_timing:true,
        bypass_spacing:!followRules,
      },
    });

    console.info("emergency push completed",{operation_id:operationId,mode,campaign_id:campaign.id,public_id:campaign.public_id||null,started_at:operationStartedAt.toISOString(),completed_at:new Date().toISOString(),duration_ms:Date.now()-operationStartedAt.getTime(),channels_considered:eligibleChannels.length,successful_placements:posted,failure_reason_counts:failureReasonCounts,bypass_timing:true,bypass_spacing:!followRules});

    return NextResponse.json({
      success: posted>0,
      status:operationStatus,
      message:posted>0?`${posted} placement${posted===1?"":"s"} completed${partialPlacements?`; ${partialPlacements} require cleanup`:""}.`:`No ads were delivered. ${skipped} channels were skipped and ${failed} failed.`,
      operationId,
      mode,
      followRules,
      campaignId: Number(campaign.public_id || publicCampaignId || campaign.id),
      internalCampaignId: campaign.id,
      eligibleChannels: eligibleChannels.length,
      attempted,
      posted,
      failed,
      skipped,
      activeInventorySnapshot,
      exemptChannels,
      inaccessibleNoPermissionChannels: inaccessibleChannels + permissionFailures,
      retryAttempted,
      finalFailed,
      deleteSummary,
      settlementSummary,
      failedChannels,
      stoppedReason:stopReason,
      counters:{
        channels_considered:eligibleChannels.length+skippedByExclusion,
        globally_eligible:eligibleChannels.length+skippedByExclusion,
        targeting_eligible:eligibleChannels.length,
        health_eligible:results.filter(result=>!String(result.reason||"").startsWith("telegram_unhealthy_")).length,
        capacity_eligible:results.filter(result=>result.reason!=="channel_capacity_exhausted").length,
        frequency_eligible:eligibleChannels.length,
        affordability_eligible:results.filter(result=>!["campaign_unaffordable","daily_cap_reached","advertiser_balance_insufficient"].includes(String(result.reason||""))).length,
        reservation_attempts:results.filter(result=>"postId" in result).length,
        reservation_conflicts:reservationConflicts,
        telegram_attempts:attempted,
        telegram_success:posted,
        telegram_failed:failed,
        claims_released:claimReleases,
        auto_paused_channels:autoPausedChannels,
        successful_placements:posted,
        partial_success:partialPlacements,
        victims_considered:results.filter(result=>"replacementVictim" in result&&result.replacementVictim).length,
        victims_locked:results.filter(result=>"replacementVictim" in result&&result.replacementVictim&&"postId" in result).length,
        victims_settled:results.filter(result=>"replacementSettlement" in result&&result.replacementSettlement).length,
        settlement_failed:results.filter(result=>"settlementFailed" in result&&result.settlementFailed).length,
        settlement_retryable:results.filter(result=>"settlementRetryable" in result&&result.settlementRetryable).length,
        replacement_send_attempts:results.filter(result=>"replacementVictim" in result&&result.replacementVictim&&!result.skipped).length,
        replacement_send_success:results.filter(result=>"replacementVictim" in result&&result.replacementVictim&&result.ok).length,
        victim_delete_attempts:deleteSummary?.checked||0,
        victim_delete_success:deleteSummary?.deleted||0,
        victim_already_missing:results.filter(result=>"victimAlreadyMissing" in result&&result.victimAlreadyMissing).length,
        victim_delete_failed:deleteSummary?.failed||0,
        replacement_claims_released:results.filter(result=>"replacementVictim" in result&&result.replacementVictim&&"claimReleased" in result&&result.claimReleased).length,
        full_success:results.filter(result=>result.ok&&!("partial" in result&&result.partial)).length,
      },
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

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleCampaignEmergencyPush(request, context, "main");
}
