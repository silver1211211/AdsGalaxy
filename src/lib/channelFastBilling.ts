import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { creditUserLockedBalance } from "@/lib/earnings";
import { getPublisherQuality } from "@/lib/publisherQuality";
import { recordPayoutSafetyCheck } from "@/lib/revenueProtection";

const money = (value: number) => Number(Math.max(0, value).toFixed(8));

type LockedPost = RowDataPacket & {
  campaign_id: number; channel_id: number; publisher_id: number; campaign_type: string;
  campaign_status: string; post_status: string; budget: string | number; cpm: string | number; daily_budget_limit: string | number | null;
  views: string | number; settled_views: string | number; settled_clicks: string | number;
};

async function lockedPost(conn: PoolConnection, postId: number) {
  const [rows] = await conn.query<LockedPost[]>(`
    SELECT cp.campaign_id, cp.channel_id, cp.views, cp.settled_views, cp.settled_clicks,
      c.type campaign_type, c.status campaign_status, cp.status post_status,
      c.budget, c.cpm, c.daily_budget_limit,
      ch.user_id publisher_id
    FROM campaign_posts cp JOIN campaigns c ON c.id=cp.campaign_id
    JOIN channels ch ON ch.id=cp.channel_id WHERE cp.id=? FOR UPDATE`, [postId]);
  return rows[0] || null;
}

async function fastDebit(input: { conn: PoolConnection; postId: number; type: "click" | "view"; sourceKey: string; requestedUnits: number }) {
  const [existing] = await input.conn.query<RowDataPacket[]>("SELECT id FROM channel_advertiser_debits WHERE source_key=?", [input.sourceKey]);
  if (existing.length) return { debited: false, duplicate: true, units: 0 };
  const post = await lockedPost(input.conn, input.postId);
  if (!post || post.campaign_status !== "active" || post.post_status !== "active" || post.campaign_type !== `${input.type}s`) {
    return { debited: false, duplicate: false, units: 0 };
  }
  const unitPrice = Number(post.cpm || 0) / 1000;
  if (!(unitPrice > 0)) return { debited: false, duplicate: false, units: 0 };
  const [[today]] = await input.conn.query<Array<RowDataPacket & { spend: string | number }>>(
    `SELECT
      COALESCE((SELECT SUM(advertiser_debit) FROM channel_advertiser_debits WHERE campaign_id=? AND created_at>=CURDATE()),0)
      + COALESCE((SELECT SUM(advertiser_debit) FROM channel_settlement_ledger WHERE campaign_id=? AND created_at>=CURDATE()),0) spend`,
    [post.campaign_id, post.campaign_id]
  );
  const budget = Math.max(0, Number(post.budget || 0));
  const dailyCap = Number(post.daily_budget_limit || 0);
  const dailyRemaining = dailyCap > 0 ? Math.max(0, dailyCap - Number(today?.spend || 0)) : Number.POSITIVE_INFINITY;
  const affordableUnits = Math.max(0, Math.floor((Math.min(budget, dailyRemaining) + 1e-10) / unitPrice));
  const alreadySettled = input.type === "click" ? Number(post.settled_clicks || 0) : Number(post.settled_views || 0);
  const confirmedUnits = input.type === "click"
    ? Number((await input.conn.query<Array<RowDataPacket & { count: number }>>("SELECT COUNT(*) count FROM campaign_clicks WHERE post_id=?", [input.postId]))[0][0]?.count || 0)
    : Number(post.views || 0);
  const unbilledUnits = Math.max(0, confirmedUnits - alreadySettled);
  const units = Math.min(Math.max(0, Math.floor(input.requestedUnits)), unbilledUnits, affordableUnits);
  if (!units) return { debited: false, duplicate: false, units: 0 };
  const debit = money(units * unitPrice);
  const [campaignUpdate] = await input.conn.query<ResultSetHeader>(`
    UPDATE campaigns SET budget=GREATEST(budget-?,0), channel_spend=channel_spend+?
    WHERE id=? AND status='active' AND budget>=?`, [debit, debit, post.campaign_id, debit]);
  if (campaignUpdate.affectedRows !== 1) return { debited: false, duplicate: false, units: 0 };
  await input.conn.query(
    `INSERT INTO channel_advertiser_debits
      (source_key,settlement_type,campaign_id,post_id,channel_id,publisher_id,units,unit_price,advertiser_debit)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [input.sourceKey, input.type, post.campaign_id, input.postId, post.channel_id, post.publisher_id, units, unitPrice, debit]
  );
  const settledColumn = input.type === "click" ? "settled_clicks" : "settled_views";
  await input.conn.query(`UPDATE campaign_posts SET ${settledColumn}=${settledColumn}+?, spend=spend+? WHERE id=?`, [units, debit, input.postId]);
  if (budget - debit <= 1e-10) {
    await input.conn.query("UPDATE campaigns SET status='budget_exhausted',budget=0,budget_exhausted_at=NOW(),pause_reason='budget_exhausted' WHERE id=?", [post.campaign_id]);
  }
  return { debited: true, duplicate: false, units };
}

export async function debitChannelClick(postId: number, clickId: number) {
  const conn = await pool.getConnection();
  try { await conn.beginTransaction(); const result = await fastDebit({ conn, postId, type: "click", sourceKey: `click:${clickId}`, requestedUnits: 1 }); await conn.commit(); return result; }
  catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}

export async function debitConfirmedChannelViews(postId: number, confirmedViews: number) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fastDebit({ conn, postId, type: "view", sourceKey: `view:${postId}:${confirmedViews}`, requestedUnits: confirmedViews });
    await conn.commit(); return result;
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}

export async function settlePendingChannelPublisherCredits(limit = 500) {
  const [ids] = await pool.query<Array<RowDataPacket & { id: number }>>(
    "SELECT id FROM channel_advertiser_debits WHERE publisher_status='pending' ORDER BY id LIMIT ?", [limit]);
  let settled = 0; let credited = 0;
  for (const candidate of ids) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query<Array<RowDataPacket & Record<string, unknown>>>(
        `SELECT d.*,c.user_id advertiser_id FROM channel_advertiser_debits d
         JOIN campaigns c ON c.id=d.campaign_id
         WHERE d.id=? AND d.publisher_status='pending' FOR UPDATE`, [candidate.id]);
      const row = rows[0]; if (!row) { await conn.rollback(); continue; }
      const [[settings]] = await conn.query<Array<RowDataPacket & { margin: string; reserve: string }>>(
        "SELECT MAX(CASE WHEN `key`='platform_margin_percent' THEN value END) margin, MAX(CASE WHEN `key`='safety_reserve_percent' THEN value END) reserve FROM settings WHERE `key` IN ('platform_margin_percent','safety_reserve_percent')");
      const debit = Number(row.advertiser_debit || 0);
      const margin = Math.min(100, Math.max(0, Number(settings?.margin || 40))) / 100;
      const reserve = Math.min(100, Math.max(0, Number(settings?.reserve || 10))) / 100;
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
      });
      if (safety.status !== "passed") throw new Error("payout_safety_check_failed");
      if (!(await creditUserLockedBalance(conn, Number(row.publisher_id), publisherCredit))) throw new Error("publisher_credit_failed");
      const table = row.settlement_type === "view" ? "ad_settlements_views" : "ad_settlements";
      const metric = row.settlement_type === "view" ? "views_count" : "clicks_count";
      await conn.query(`INSERT INTO ${table} (post_id,campaign_id,advertiser_id,channel_id,publisher_id,${metric},advertiser_paid,publisher_reward,status) VALUES (?,?,?,?,?,?,?,?,'locked')`,
        [row.post_id,row.campaign_id,row.advertiser_id,row.channel_id,row.publisher_id,row.units,debit,publisherCredit]);
      await conn.query("UPDATE campaign_posts SET publisher_earnings=publisher_earnings+?,platform_revenue=platform_revenue+?,reserve_amount=reserve_amount+? WHERE id=?", [publisherCredit,platformRevenue,reserveAmount,row.post_id]);
      await conn.query("UPDATE campaigns SET channel_publisher_earnings=channel_publisher_earnings+?,channel_platform_revenue=channel_platform_revenue+?,channel_reserve_amount=channel_reserve_amount+? WHERE id=?", [publisherCredit,platformRevenue,reserveAmount,row.campaign_id]);
      await conn.query("UPDATE channel_advertiser_debits SET publisher_status='settled',publisher_credit=?,publisher_settled_at=NOW() WHERE id=?", [publisherCredit,row.id]);
      await conn.commit(); settled++; credited += publisherCredit;
    } catch (error) { await conn.rollback(); console.error("Pending channel publisher settlement failed", { id: candidate.id, error }); }
    finally { conn.release(); }
  }
  return { candidates: ids.length, settled, publisherCredited: money(credited) };
}
