import crypto from "crypto";
import type { PoolConnection } from "mysql2/promise";
import pool from "@/lib/db";

export const CONVERSION_TYPES = [
  "registration",
  "signup",
  "download",
  "purchase",
  "deposit",
  "subscription",
  "lead",
  "custom_event",
  "mini_app_open",
  "wallet_connect",
] as const;

export type ConversionType = typeof CONVERSION_TYPES[number];
export type CampaignType = "campaign" | "miniapp";

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

function clean(value: unknown) {
  return String(value || "").trim();
}

export function normalizeConversionType(value: unknown): ConversionType {
  const type = clean(value).toLowerCase().replace(/\s+/g, "_");
  if (CONVERSION_TYPES.includes(type as ConversionType)) return type as ConversionType;
  return "custom_event";
}

export function validatePostbackUrl(value: unknown) {
  const url = clean(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("Postback URL must use HTTPS.");
    if (!url.includes("{click_id}")) throw new Error("Postback URL must include {click_id}.");
    return url;
  } catch (error: any) {
    throw new Error(error?.message || "Postback URL must be a valid HTTPS URL.");
  }
}

export function appendClickId(url: string, clickId: string) {
  const parsed = new URL(url);
  parsed.searchParams.set("click_id", clickId);
  return parsed.toString();
}

export function createClickId() {
  return `adx_click_${crypto.randomBytes(16).toString("hex")}`;
}

async function getAttributionWindowDays(conn?: PoolConnection) {
  const db = conn || pool;
  const [[row]]: any = await db.query("SELECT value FROM settings WHERE `key` = 'conversion_attribution_window_days' LIMIT 1");
  const days = Number(row?.value || 7);
  return Number.isFinite(days) && days > 0 ? Math.min(30, Math.max(1, days)) : 7;
}

export async function recordAdClick(input: {
  conn?: PoolConnection;
  campaignType: CampaignType;
  campaignId: number;
  advertiserId: number;
  creativeId?: string | null;
  category?: string | null;
  inventoryType?: string | null;
  inventoryId?: number | null;
  postId?: number | null;
  miniappId?: number | null;
  botId?: number | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  fingerprint?: string | null;
  sessionId?: string | null;
}) {
  const db = input.conn || pool;
  const clickId = createClickId();
  await db.query(`
    INSERT INTO ad_click_attribution
      (
        click_id, campaign_type, campaign_id, advertiser_id, creative_id, category,
        inventory_type, inventory_id, post_id, miniapp_id, bot_id, request_id,
        ip_address, user_agent, fingerprint, session_id
      )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    clickId,
    input.campaignType,
    input.campaignId,
    input.advertiserId,
    input.creativeId || null,
    input.category || null,
    input.inventoryType || null,
    input.inventoryId || null,
    input.postId || null,
    input.miniappId || null,
    input.botId || null,
    input.requestId || null,
    input.ipAddress || null,
    input.userAgent || null,
    input.fingerprint || null,
    input.sessionId || null,
  ]);
  return clickId;
}

export async function recordConversion(input: {
  clickId: string;
  eventType: unknown;
  eventName?: unknown;
  value?: unknown;
  currency?: unknown;
  source?: string;
  payload?: Record<string, unknown>;
}) {
  const clickId = clean(input.clickId);
  if (!clickId) throw new Error("click_id is required");

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const attributionWindowDays = await getAttributionWindowDays(conn);
    const [clickRows]: any = await conn.query(
      `SELECT *
       FROM ad_click_attribution
       WHERE click_id = ?
         AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       FOR UPDATE`,
      [clickId, attributionWindowDays]
    );
    if (clickRows.length === 0) throw new Error("click_id not found or outside attribution window");

    const click = clickRows[0];
    const eventType = normalizeConversionType(input.eventType);
    const eventName = clean(input.eventName) || (eventType === "custom_event" ? "Custom Event" : null);
    const conversionId = crypto
      .createHash("sha256")
      .update(`${clickId}:${eventType}:${eventName || ""}`)
      .digest("hex");
    const value = Math.max(0, toNumber(input.value));
    const currency = clean(input.currency || "USD").slice(0, 10).toUpperCase() || "USD";

    const [insertResult]: any = await conn.query(`
      INSERT IGNORE INTO ad_conversions
        (
          conversion_id, click_id, campaign_type, campaign_id, advertiser_id,
          event_type, event_name, conversion_value, currency, source, payload
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      conversionId,
      clickId,
      click.campaign_type,
      click.campaign_id,
      click.advertiser_id,
      eventType,
      eventName,
      value,
      currency,
      input.source || "postback",
      JSON.stringify(input.payload || {}),
    ]);

    if (insertResult.affectedRows !== 1) {
      await queueConversionReview(conn, {
        campaignType: click.campaign_type,
        campaignId: Number(click.campaign_id),
        advertiserId: Number(click.advertiser_id),
        reason: "duplicate_conversion",
        metadata: { click_id: clickId, event_type: eventType, event_name: eventName },
      });
      await conn.commit();
      return { duplicate: true, click_id: clickId, conversion_id: conversionId };
    }

    await conn.query(
      "UPDATE ad_click_attribution SET conversion_status = 'converted', converted_at = COALESCE(converted_at, NOW()) WHERE click_id = ?",
      [clickId]
    );

    await detectSuspiciousConversionActivity(conn, click.campaign_type, Number(click.campaign_id), Number(click.advertiser_id));
    await conn.commit();
    return { duplicate: false, click_id: clickId, conversion_id: conversionId };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function queueConversionReview(conn: PoolConnection, input: {
  campaignType: string;
  campaignId: number;
  advertiserId: number;
  reason: string;
  metadata: Record<string, unknown>;
}) {
  await conn.query(`
    INSERT INTO conversion_review_queue
      (campaign_type, campaign_id, advertiser_id, reason, status, metadata)
    SELECT ?, ?, ?, ?, 'open', ?
    WHERE NOT EXISTS (
      SELECT 1 FROM conversion_review_queue
      WHERE campaign_type = ? AND campaign_id = ? AND reason = ? AND status IN ('open', 'monitor')
    )
  `, [
    input.campaignType,
    input.campaignId,
    input.advertiserId,
    input.reason,
    JSON.stringify(input.metadata),
    input.campaignType,
    input.campaignId,
    input.reason,
  ]);
}

async function detectSuspiciousConversionActivity(conn: PoolConnection, campaignType: string, campaignId: number, advertiserId: number) {
  const [[summary]]: any = await conn.query(`
    SELECT
      COUNT(DISTINCT ac.click_id) as clicks,
      COUNT(conv.id) as conversions,
      SUM(CASE WHEN conv.created_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE) THEN 1 ELSE 0 END) as recent_conversions
    FROM ad_click_attribution ac
    LEFT JOIN ad_conversions conv ON conv.click_id = ac.click_id
    WHERE ac.campaign_type = ? AND ac.campaign_id = ? AND ac.created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
  `, [campaignType, campaignId]);
  const clicks = toNumber(summary?.clicks);
  const conversions = toNumber(summary?.conversions);
  const recentConversions = toNumber(summary?.recent_conversions);
  const conversionRate = clicks > 0 ? conversions / clicks : 0;

  if ((clicks >= 20 && conversionRate > 0.8) || recentConversions >= 25) {
    await queueConversionReview(conn, {
      campaignType,
      campaignId,
      advertiserId,
      reason: conversionRate > 0.8 ? "abnormally_high_conversion_rate" : "conversion_spike",
      metadata: { clicks, conversions, conversion_rate: conversionRate, recent_conversions: recentConversions },
    });
  }
}

export async function advertiserConversionSummary(advertiserId: number) {
  const [rows]: any = await pool.query(`
    SELECT
      COUNT(DISTINCT ac.click_id) as tracked_clicks,
      COUNT(conv.id) as conversions,
      COALESCE(SUM(conv.conversion_value), 0) as conversion_value
    FROM ad_click_attribution ac
    LEFT JOIN ad_conversions conv ON conv.click_id = ac.click_id
    WHERE ac.advertiser_id = ?
  `, [advertiserId]);
  return rows[0] || { tracked_clicks: 0, conversions: 0, conversion_value: 0 };
}
