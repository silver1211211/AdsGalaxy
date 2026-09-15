/* eslint-disable @typescript-eslint/no-explicit-any -- transactional rows join additive migration-backed tables */
import "server-only";
import crypto from "node:crypto";
import type { PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import pool from "@/lib/db";
import { getPublisherQuality } from "@/lib/publisherQuality";
import { creditUserLockedBalance } from "@/lib/earnings";
import { shadowWriteChannelAllocation } from "@/lib/channelAllocationLedger";
import { resolvePrivateInviteLink } from "@/lib/telegramMtproto";
import { claimAdvertiserDirectDebit } from "@/lib/advertiserDirectDebit";
import { deleteActiveCampaignPosts, deleteExhaustedChannelCampaignPosts } from "@/lib/campaignPostDeletion";

export const GROWTH_DEFAULTS = { min: 0.25, recommended: 0.56, max: 5, publisher: 60, platform: 30, reserve: 10, seedCap: 10 } as const;
export const GROWTH_MIN_TOTAL_BUDGET = 100;
export const GROWTH_MIN_DAILY_BUDGET = 50;
const money = (value: number) => Number(value.toFixed(8));
export function validateGrowthBudgets(totalBudget: unknown, dailyBudget: unknown) {
  const total = Number(totalBudget);
  const daily = dailyBudget === null || dailyBudget === undefined || String(dailyBudget).trim() === "" ? null : Number(dailyBudget);
  if (!Number.isFinite(total) || total < GROWTH_MIN_TOTAL_BUDGET) throw new Error(`Channel Growth total budget must be at least $${GROWTH_MIN_TOTAL_BUDGET}.`);
  if (daily !== null && (!Number.isFinite(daily) || daily < GROWTH_MIN_DAILY_BUDGET)) throw new Error(`Channel Growth daily budget must be at least $${GROWTH_MIN_DAILY_BUDGET} when provided.`);
  if (daily !== null && daily > total) throw new Error("Daily budget limit cannot exceed total campaign budget.");
  return { total, daily };
}
export function validateGrowthMessageText(messageText: unknown) {
  const value = String(messageText ?? "");
  if (/(?:https?:\/\/[^\s]+|www\.[^\s]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)/iu.test(value)) throw new Error("Channel Growth message text cannot contain URLs. Use the destination channel field instead.");
  return value;
}
async function cleanupGrowthPosts(campaignId: number, exhausted: boolean) {
  try {
    return exhausted ? await deleteExhaustedChannelCampaignPosts(campaignId) : await deleteActiveCampaignPosts(campaignId);
  } catch (error) {
    console.error("Channel Growth Telegram post cleanup failed", { campaignId, exhausted, error: error instanceof Error ? error.message : "unknown_error" });
    return null;
  }
}
export function estimateSubscribers(budget: unknown, cps: unknown) {
  const budgetUnits = BigInt(Math.max(0, Math.round(Number(budget) * 100_000_000)));
  const cpsUnits = BigInt(Math.max(0, Math.round(Number(cps) * 100_000_000)));
  return cpsUnits > BigInt(0) ? Number(budgetUnits / cpsUnits) : 0;
}
export function validateGrowthShares(publisher: number, platform: number, reserve: number) {
  if (![publisher, platform, reserve].every(Number.isFinite) || publisher < 0 || platform < 0 || reserve < 0 || Math.abs(publisher + platform + reserve - 100) > 1e-8) throw new Error("Growth shares must total 100");
}
export async function getGrowthSettings(conn?: PoolConnection) {
  const db = conn || pool;
  const keys = ["channel_growth_cps_min","channel_growth_cps_recommended","channel_growth_cps_max","channel_growth_publisher_share","channel_growth_platform_share","channel_growth_reserve_share","channel_growth_seed_cap"];
  const [rows] = await db.query<Array<RowDataPacket & { key: string; value: string }>>("SELECT `key`,value FROM settings WHERE `key` IN (?)", [keys]);
  const values = new Map(rows.map((row) => [row.key, Number(row.value)]));
  const result = { min: values.get(keys[0]) ?? GROWTH_DEFAULTS.min, recommended: values.get(keys[1]) ?? GROWTH_DEFAULTS.recommended, max: values.get(keys[2]) ?? GROWTH_DEFAULTS.max, publisher: values.get(keys[3]) ?? GROWTH_DEFAULTS.publisher, platform: values.get(keys[4]) ?? GROWTH_DEFAULTS.platform, reserve: values.get(keys[5]) ?? GROWTH_DEFAULTS.reserve, seedCap: values.get(keys[6]) ?? GROWTH_DEFAULTS.seedCap };
  if (result.min > result.recommended || result.recommended > result.max) throw new Error("Invalid Growth CPS settings");
  validateGrowthShares(result.publisher, result.platform, result.reserve);
  return result;
}
export function growthInviteHash(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
export function isMembershipJoin(oldStatus: string | null, newStatus: string | null) {
  return !["member","administrator","creator"].includes(String(oldStatus)) && ["member","administrator","creator"].includes(String(newStatus));
}
async function telegram(method: string, body: Record<string, unknown>) {
  const token=process.env.BOT_TOKEN; if(!token) throw new Error("Growth tracking bot is not configured");
  const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(10_000)});
  const payload=await response.json(); if(!response.ok||!payload.ok) throw new Error("Telegram destination verification failed"); return payload.result;
}
export async function verifyGrowthDestination(value: string) {
  const normalized=String(value||"").trim(); let chatRef:string|number;
  if(/^https:\/\/t\.me\/(?:\+|joinchat\/)/i.test(normalized)){const resolved=await resolvePrivateInviteLink(normalized);if(!resolved.ok)throw new Error("Private destination could not be resolved");chatRef=resolved.chatId;}
  else {const username=normalized.match(/^https:\/\/t\.me\/([A-Za-z0-9_]+)\/?$/i)?.[1];if(!username)throw new Error("Destination must be a Telegram channel link");chatRef=`@${username}`;}
  const me=await telegram("getMe",{}); const chat=await telegram("getChat",{chat_id:chatRef});
  if(chat.type!=="channel")throw new Error("Destination must be a Telegram channel");
  const member=await telegram("getChatMember",{chat_id:chat.id,user_id:me.id});
  const admin=member.status==="creator"||member.status==="administrator"; const canInvite=member.status==="creator"||member.can_invite_users===true;
  if(!admin||!canInvite)throw new Error("Add @Ads_Galaxy_bot as administrator with invite permission");
  return { chatId:Number(chat.id), title:String(chat.title||""), username:chat.username?String(chat.username):null };
}
export async function processGrowthMembershipEvent(eventId: number) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [events] = await conn.query<Array<RowDataPacket & any>>(`SELECT e.*,i.source_channel_id,i.source_publisher_id FROM channel_growth_membership_events e LEFT JOIN channel_growth_invites i ON i.id=e.invite_id WHERE e.id=? FOR UPDATE`, [eventId]);
    const event = events[0];
    if (!event || event.processing_status !== "pending") { await conn.rollback(); return { status: "duplicate" }; }
    const nonbillable = event.event_type === "chat_join_request" ? "awaiting_membership" : event.is_bot ? "bot_account" : !event.invite_id ? "unattributed_invite" : !isMembershipJoin(event.old_status,event.new_status) ? "not_membership_transition" : null;
    if (nonbillable) { await conn.query("UPDATE channel_growth_membership_events SET processing_status='nonbillable',nonbillable_reason=?,processed_at=NOW() WHERE id=?",[nonbillable,eventId]); await conn.commit(); return { status:"nonbillable", reason:nonbillable }; }
    const [campaigns] = await conn.query<Array<RowDataPacket & any>>("SELECT * FROM campaigns WHERE id=? AND campaign_kind='channel_growth' FOR UPDATE",[event.campaign_id]);
    const campaign=campaigns[0]; const cps=Number(campaign?.cost_per_subscriber||0);
    if (!campaign || Number(campaign.destination_chat_id) !== Number(event.destination_chat_id) || Number(event.source_publisher_id) === Number(campaign.user_id) || !event.campaign_valid_at_event || cps <= 0 || Number(campaign.budget) + 1e-10 < cps) { const reason=!campaign?"invalid_campaign":Number(event.source_publisher_id)===Number(campaign.user_id)?"self_delivery":!event.campaign_valid_at_event?"campaign_inactive_at_event":"insufficient_budget";await conn.query("UPDATE channel_growth_membership_events SET processing_status='nonbillable',nonbillable_reason=?,processed_at=NOW() WHERE id=?",[reason,eventId]); await conn.commit(); return {status:"nonbillable"}; }
    const sourceKey=`channel_growth:${campaign.id}:${event.destination_chat_id}:${event.telegram_user_id}`;
    const [claim]=await conn.query<ResultSetHeader>(`INSERT IGNORE INTO channel_growth_conversions (campaign_id,destination_chat_id,telegram_user_id,invite_id,campaign_post_id,source_channel_id,source_publisher_id,membership_event_id,joined_at,cost_per_subscriber,debit_source_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[campaign.id,event.destination_chat_id,event.telegram_user_id,event.invite_id,event.campaign_post_id,event.source_channel_id,event.source_publisher_id,event.id,event.event_at,cps,sourceKey]);
    if (claim.affectedRows!==1) { await conn.query("UPDATE channel_growth_membership_events SET processing_status='duplicate',nonbillable_reason='duplicate_subscriber',processed_at=NOW() WHERE id=?",[eventId]); await conn.commit(); return {status:"duplicate"}; }
    if (campaign.funding_model === "direct_debit") {
      const walletDebit=await claimAdvertiserDirectDebit(conn,{sourceKey,advertiserId:Number(campaign.user_id),campaignId:Number(campaign.id),campaignTable:"campaigns",billingType:"channel_growth",amount:cps,description:`Channel Growth subscriber charge for campaign #${campaign.id}`});
      if(!walletDebit.ok){
        if(walletDebit.duplicate){await conn.query("UPDATE channel_growth_membership_events SET processing_status='duplicate',nonbillable_reason='duplicate_subscriber',processed_at=NOW() WHERE id=?",[eventId]);await conn.commit();return {status:"duplicate"};}
        await conn.query("DELETE FROM channel_growth_conversions WHERE id=?",[claim.insertId]);
        await conn.query("UPDATE campaigns SET status='paused',pause_reason='insufficient_balance' WHERE id=? AND status='active'",[campaign.id]);
        await conn.query("UPDATE channel_growth_invites SET status='revoke_pending' WHERE campaign_id=? AND status='active'",[campaign.id]);
        await conn.commit();
        await cleanupGrowthPosts(Number(campaign.id), false);
        return {status:"insufficient_balance"};
      }
    }
    const [debit]=await conn.query<ResultSetHeader>("UPDATE campaigns SET budget=budget-?,channel_spend=channel_spend+? WHERE id=? AND budget>=?",[cps,cps,campaign.id,cps]);
    if(debit.affectedRows!==1) throw new Error("GROWTH_BUDGET_RACE");
    const settings=await getGrowthSettings(conn); const quality=await getPublisherQuality(Number(event.source_channel_id),conn);
    const publisherMax=money(cps*settings.publisher/100); const publisher=money(publisherMax*quality.qualityWeight); const qualityAdjustment=money(publisherMax-publisher); const platform=money(cps*settings.platform/100); const reserve=money(cps*settings.reserve/100);
    const outstandingSeed=Math.max(0,Number(campaign.growth_seed_allocated||0)-Number(campaign.growth_seed_recovered||0)); const seedRecovery=Math.min(platform,outstandingSeed);
    if (!(await creditUserLockedBalance(conn,event.source_publisher_id,publisher))) throw new Error("GROWTH_PUBLISHER_CREDIT_FAILED");
    await conn.query("UPDATE channel_growth_conversions SET status='billed',advertiser_debit=?,publisher_allocation=?,platform_allocation=?,reserve_allocation=?,quality_adjustment=?,seed_recovery=?,billed_at=NOW() WHERE id=?",[cps,publisher,platform,reserve,qualityAdjustment,seedRecovery,claim.insertId]);
    await conn.query("UPDATE campaigns SET channel_publisher_earnings=channel_publisher_earnings+?,channel_platform_revenue=channel_platform_revenue+?,channel_reserve_amount=channel_reserve_amount+?,growth_seed_recovered=growth_seed_recovered+? WHERE id=?",[publisher,platform,reserve,seedRecovery,campaign.id]);
    const becameExhausted=Number(campaign.budget)-cps+1e-10<cps;
    if(becameExhausted){await conn.query("UPDATE campaigns SET status='budget_exhausted',budget_exhausted_at=NOW() WHERE id=?",[campaign.id]);await conn.query("UPDATE channel_growth_invites SET status='revoke_pending' WHERE campaign_id=? AND status='active'",[campaign.id]);await conn.query("UPDATE campaign_posts SET status='cleanup_pending' WHERE campaign_id=? AND status IN ('active','posted','sent')",[campaign.id]);}
    await shadowWriteChannelAllocation(conn,{sourceKey,sourceType:"adjustment",sourceRecordId:Number(claim.insertId),campaignId:Number(campaign.id),postId:Number(event.campaign_post_id),channelId:Number(event.source_channel_id),advertiserId:Number(campaign.user_id),publisherId:Number(event.source_publisher_id),billableUnits:1,unitPrice:cps,advertiserDebit:cps,publisherAllocation:publisher,platformAllocation:platform,reserveAllocation:reserve,qualityAdjustment,policyVersion:"channel-growth-v1-60-30-10-quality",occurredAt:new Date(event.event_at),settledAt:new Date(),fraudStatus:"clear"});
    await conn.query("UPDATE channel_growth_membership_events SET processing_status='billed',processed_at=NOW() WHERE id=?",[eventId]);
    await conn.commit();
    if(becameExhausted)await cleanupGrowthPosts(Number(campaign.id), true);
    return {status:"billed"};
  } catch(error){await conn.rollback();throw error;} finally{conn.release();}
}

export async function settleGrowthSeedViews(postId:number,totalViews:number){const conn=await pool.getConnection();try{await conn.beginTransaction();const [rows]=await conn.query<Array<RowDataPacket & any>>(`SELECT cp.id,cp.campaign_id,cp.channel_id,ch.user_id publisher_id,c.growth_seed_allocated FROM campaign_posts cp JOIN campaigns c ON c.id=cp.campaign_id JOIN channels ch ON ch.id=cp.channel_id WHERE cp.id=? AND c.campaign_kind='channel_growth' AND c.status='active' FOR UPDATE`,[postId]);const row=rows[0];if(!row){await conn.rollback();return {status:"not_growth"};}const settings=await getGrowthSettings(conn);const [[prior]]=await conn.query<Array<RowDataPacket & {views:number}>>("SELECT COALESCE(MAX(eligible_impressions),0) views FROM channel_growth_seed_ledger WHERE campaign_post_id=?",[postId]);const delta=Math.max(0,Math.floor(totalViews)-Number(prior?.views||0));const remaining=Math.max(0,settings.seedCap-Number(row.growth_seed_allocated||0));if(delta===0||remaining===0){await conn.rollback();return {status:"no_increment"};}const [[cpmRow]]=await conn.query<Array<RowDataPacket & {value:string}>>("SELECT value FROM settings WHERE `key`='recommended_cpm_views' LIMIT 1");const gross=Math.min(remaining,money(delta*Math.max(0,Number(cpmRow?.value||0))/1000));const quality=await getPublisherQuality(Number(row.channel_id),conn);const credit=money(gross*quality.qualityWeight);const sourceKey=`growth_seed:${row.campaign_id}:${postId}:${Math.floor(totalViews)}`;const [insert]=await conn.query<ResultSetHeader>("INSERT IGNORE INTO channel_growth_seed_ledger (campaign_id,campaign_post_id,source_channel_id,source_publisher_id,source_key,eligible_impressions,publisher_credit,status,settled_at) VALUES (?,?,?,?,?,?,?,'settled',NOW())",[row.campaign_id,postId,row.channel_id,row.publisher_id,sourceKey,Math.floor(totalViews),credit]);if(insert.affectedRows!==1){await conn.rollback();return {status:"duplicate"};}if(credit>0&&!(await creditUserLockedBalance(conn,row.publisher_id,credit)))throw new Error("GROWTH_SEED_CREDIT_FAILED");await conn.query("UPDATE campaigns SET growth_seed_allocated=growth_seed_allocated+?,channel_publisher_earnings=channel_publisher_earnings+? WHERE id=?",[gross,credit,row.campaign_id]);await conn.commit();return {status:"settled",credit};}catch(error){await conn.rollback();throw error;}finally{conn.release();}}
