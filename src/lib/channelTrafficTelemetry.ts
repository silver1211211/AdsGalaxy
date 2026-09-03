/* eslint-disable @typescript-eslint/no-explicit-any -- mysql aggregate result tuples are not schema-generated */
import crypto from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

type Db = typeof pool | PoolConnection;
function secret() { return process.env.TELEMETRY_HASH_SECRET || process.env.ADMIN_SESSION_SECRET || process.env.CRON_SECRET || ""; }
function digest(value: string) { const key = secret(); return key && value ? crypto.createHmac("sha256", key).update(value).digest("hex") : null; }
function networkIdentity(ip: string) {
  const clean = ip.trim();
  const ipv4 = clean.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (ipv4) return `${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.0/24`;
  if (clean.includes(":")) return `${clean.split(":").slice(0, 4).join(":")}::/64`;
  return clean;
}
export function telemetryCountry(headers: Headers) {
  const value = (headers.get("cf-ipcountry") || headers.get("x-vercel-ip-country") || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(value) ? value : null;
}
export function buildTelemetryIdentity(input: { ip?: string; userAgent?: string; sessionId?: string; fingerprint?: string }) {
  return { network_hash: digest(networkIdentity(input.ip || "")), device_hash: digest(input.fingerprint || `${input.userAgent || ""}`), session_hash: digest(input.sessionId || "") };
}
export async function recordChannelTrafficEvent(input: { db?: Db; eventKey: string; eventType: "click" | "impression"; channelId: number; campaignId: number; postId?: number | null; telegramUserId?: string | number | null; ip?: string; country?: string | null; userAgent?: string; sessionId?: string; fingerprint?: string; duplicate?: boolean }) {
  const db = input.db || pool;
  if (!secret()) return { recorded: false, duplicate: false, reason: "telemetry_secret_unavailable" };
  const [tables] = await db.query<RowDataPacket[]>("SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_traffic_events' LIMIT 1");
  if (!tables.length) return { recorded: false, duplicate: false, reason: "telemetry_schema_unavailable" };
  const identity = buildTelemetryIdentity(input);
  const eventHash = digest(input.eventKey);
  const [result]: any = await db.query(`INSERT IGNORE INTO channel_traffic_events
    (event_key,event_type,channel_id,campaign_id,post_id,telegram_user_id,session_hash,network_hash,country_code,device_hash,duplicate_event,created_at,retention_until)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(6),DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 90 DAY))`, [eventHash,input.eventType,input.channelId,input.campaignId,input.postId||null,input.telegramUserId||null,identity.session_hash,identity.network_hash,input.country||null,identity.device_hash,input.duplicate?1:0]);
  if (!result.affectedRows) return { recorded: false, duplicate: true, reason: "replayed_event" };
  const [[concentration]]: any = await db.query(`SELECT COUNT(*) total,
    SUM(network_hash IS NOT NULL AND network_hash=?) same_network,
    SUM(device_hash IS NOT NULL AND device_hash=?) same_device,
    SUM(session_hash IS NOT NULL AND session_hash=?) same_session,
    SUM(telegram_user_id IS NOT NULL AND telegram_user_id=?) same_user
    FROM channel_traffic_events WHERE channel_id=? AND created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 5 MINUTE)`, [identity.network_hash,identity.device_hash,identity.session_hash,input.telegramUserId||null,input.channelId]);
  const total=Number(concentration?.total||0), sameNetwork=Number(concentration?.same_network||0), sameDevice=Number(concentration?.same_device||0), sameSession=Number(concentration?.same_session||0), sameUser=Number(concentration?.same_user||0);
  const rapid=total>=20, concentrated=total>=10 && [sameNetwork,sameDevice,sameSession,sameUser].some(count=>count/total>=0.8);
  if (rapid || concentrated) await db.query("UPDATE channel_traffic_events SET rapid_burst=?,concentration_alert=? WHERE event_key=?",[rapid?1:0,concentrated?1:0,eventHash]);
  return { recorded: true, duplicate: Boolean(input.duplicate), rapid_burst: rapid, concentration_alert: concentrated };
}

export async function purgeExpiredChannelTrafficEvents(db: Db = pool, limit = 5_000) {
  const boundedLimit = Math.min(20_000, Math.max(1, Math.floor(limit)));
  const [tables] = await db.query<RowDataPacket[]>("SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_traffic_events' LIMIT 1");
  if (!tables.length) return 0;
  const [result]: any = await db.query(`DELETE FROM channel_traffic_events WHERE retention_until<UTC_TIMESTAMP(6) ORDER BY retention_until LIMIT ${boundedLimit}`);
  return Number(result.affectedRows || 0);
}
