import mysql from "mysql2/promise";
import "dotenv/config";
import { classifyRejectionHistory, classifyTelegramFailure, recoveryDecision, retryDelayMs, usernameUpdateAllowed } from "./channel-recovery-policy.mjs";

const db = await mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME, charset: "utf8mb4", connectionLimit: 2 });
if (!process.env.BOT_TOKEN) throw new Error("BOT_TOKEN_missing");
const limit = Math.min(200, Math.max(1, Number(process.env.CHANNEL_IDENTITY_SYNC_LIMIT || 100)));
const gap = Math.min(2000, Math.max(250, Number(process.env.CHANNEL_IDENTITY_REQUEST_GAP_MS || 300)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nextRequestAt = 0;

async function telegram(method, payload) {
  let last;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await sleep(Math.max(0, nextRequestAt - Date.now()));
    nextRequestAt = Date.now() + gap;
    try {
      const response = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000) });
      last = await response.json();
      if (last?.ok) return last;
      if (response.status !== 429 && !last?.parameters?.retry_after) return last;
    } catch (error) {
      last = { ok: false, description: error instanceof Error ? error.message : "Telegram request failed" };
    }
    if (attempt < 6) await sleep(retryDelayMs(last, attempt));
  }
  return last;
}

const normalizeUsername = (value) => value ? String(value).replace(/^@/, "").trim() || null : null;
const me = await telegram("getMe", {});
if (!me?.ok || !me.result?.id) throw new Error(`getMe_failed: ${me?.description || "unknown"}`);

const [channels] = await db.query(`SELECT c.id,c.user_id,c.chat_id,c.username,c.title,c.channel_type,c.status,c.is_deleted,c.under_review,
  u.status publisher_status,u.is_banned FROM channels c JOIN users u ON u.id=c.user_id
  LEFT JOIN channel_telegram_identities i ON i.channel_id=c.id WHERE c.is_deleted=FALSE
  ORDER BY COALESCE(i.last_verified_at,'1970-01-01') ASC,c.id ASC LIMIT ?`, [limit]);
const ids = channels.map(({ id }) => Number(id));
const [auditRows] = ids.length ? await db.query(`SELECT channel_id,action,old_value,created_at FROM channel_admin_action_audits WHERE channel_id IN (?) ORDER BY created_at`, [ids]) : [[]];
const history = new Map();
for (const audit of auditRows) history.set(Number(audit.channel_id), [...(history.get(Number(audit.channel_id)) || []), audit]);

const totals = { checked: 0, healthy: 0, recovered: 0, metadata_updated: 0, failed: 0, temporary: 0, manual_review: 0 };
for (const channel of channels) {
  totals.checked += 1;
  const original = { status: channel.status, chat_id: channel.chat_id == null ? null : String(channel.chat_id), username: channel.username, title: channel.title };
  const rejectionKind = classifyRejectionHistory(channel.status, history.get(Number(channel.id)) || []);
  const independentPolicyBlock = Boolean(channel.under_review || channel.is_banned || channel.publisher_status !== "active");
  let target = channel.chat_id && String(channel.chat_id) !== "0" ? String(channel.chat_id) : null;
  let chat = null;
  let member = null;
  let healthy = false;
  let health = target ? { code: "temporary_error", reason: "Verification incomplete", permanent: false } : { code: "missing_chat_id", reason: "No valid permanent Telegram chat ID; username-only identity was not trusted.", permanent: true };

  if (target) {
    const [[duplicate]] = await db.query("SELECT id FROM channels WHERE is_deleted=FALSE AND chat_id=? AND id<>? LIMIT 1", [target, channel.id]);
    if (duplicate) health = { code: "duplicate_chat_id_manual_review", reason: "Permanent Telegram chat ID is assigned to multiple channel records.", permanent: false };
    else {
      let response = await telegram("getChat", { chat_id: target });
      if (!response?.ok && response?.parameters?.migrate_to_chat_id) {
        const migrated = String(response.parameters.migrate_to_chat_id);
        const [[collision]] = await db.query("SELECT id FROM channels WHERE is_deleted=FALSE AND chat_id=? AND id<>? LIMIT 1", [migrated, channel.id]);
        if (!collision) { target = migrated; response = await telegram("getChat", { chat_id: target }); }
        else health = { code: "migrated_chat_id_collision", reason: "Migrated Telegram chat ID belongs to another stored channel.", permanent: false };
      }
      if (!response?.ok) health = classifyTelegramFailure(response);
      else {
        chat = response.result;
        response = await telegram("getChatMember", { chat_id: chat.id, user_id: me.result.id });
        if (!response?.ok) health = classifyTelegramFailure(response);
        else {
          member = response.result;
          const status = String(member.status || "unknown");
          const canPost = status === "creator" || (status === "administrator" && member.can_post_messages !== false);
          if (status === "left" || status === "kicked") health = { code: "bot_removed", reason: `Ads Galaxy bot membership is ${status}.`, permanent: true };
          else if (!canPost) health = { code: "permission_missing", reason: `Ads Galaxy bot status is ${status} without posting permission.`, permanent: true };
          else { healthy = true; health = { code: "healthy", reason: null, permanent: false }; }
        }
      }
    }
  }

  const desired = recoveryDecision({ currentStatus: channel.status, telegramHealthy: healthy, rejectionKind, independentPolicyBlock });
  if (!healthy && health.permanent && !["rejected", "pending", "paused"].includes(desired.status) && rejectionKind === "none" && !independentPolicyBlock) {
    desired.status = health.code;
    desired.reason = health.code;
  }
  const username = chat ? normalizeUsername(chat.username) : normalizeUsername(channel.username);
  let usernameChanged = Boolean(chat && username !== normalizeUsername(channel.username));
  if (usernameChanged && username) {
    const [[collision]] = await db.query(`SELECT chat_id FROM channels WHERE is_deleted=FALSE AND id<>? AND LOWER(TRIM(LEADING '@' FROM username))=LOWER(?) LIMIT 1`, [channel.id, username]);
    usernameChanged = usernameUpdateAllowed({ channelChatId: chat.id, collisionChatId: collision?.chat_id });
  }
  const title = chat?.title ? String(chat.title).slice(0, 255) : channel.title;
  const titleChanged = Boolean(chat && title !== channel.title);
  const manualReview = rejectionKind === "ambiguous_rejection" || health.code.includes("collision") || (Boolean(chat) && username !== normalizeUsername(channel.username) && !usernameChanged);
  if (manualReview) totals.manual_review += 1;
  if (healthy) totals.healthy += 1; else if (health.code === "temporary_error") totals.temporary += 1; else totals.failed += 1;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[locked]] = await conn.query("SELECT status,is_deleted,user_id,chat_id FROM channels WHERE id=? FOR UPDATE", [channel.id]);
    if (!locked || locked.is_deleted || Number(locked.user_id) !== Number(channel.user_id) || String(locked.chat_id ?? "") !== String(channel.chat_id ?? "") || locked.status !== channel.status) throw new Error("channel_changed_during_verification");
    if (target && !health.code.includes("collision")) await conn.query(`INSERT INTO channel_telegram_identities
      (channel_id,telegram_chat_id,channel_type,current_username,bot_member_status,bot_can_post,last_verified_at,last_failure_code,last_failure_reason)
      VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(6),?,?) ON DUPLICATE KEY UPDATE telegram_chat_id=VALUES(telegram_chat_id),channel_type=VALUES(channel_type),
      previous_username=IF(NOT(current_username<=>VALUES(current_username)),current_username,previous_username),last_username_changed_at=IF(NOT(current_username<=>VALUES(current_username)),UTC_TIMESTAMP(6),last_username_changed_at),
      current_username=VALUES(current_username),bot_member_status=VALUES(bot_member_status),bot_can_post=VALUES(bot_can_post),last_verified_at=VALUES(last_verified_at),last_failure_code=VALUES(last_failure_code),last_failure_reason=VALUES(last_failure_reason)`,
      [channel.id, target, channel.channel_type === "private" ? "private" : "public", username, member?.status || null, healthy ? 1 : 0, healthy ? null : health.code, healthy ? null : String(health.reason || health.code).slice(0, 500)]);
    const recovered = desired.status === "active" && channel.status !== "active";
    const permanent = ["channel_not_found", "bot_removed", "permission_missing"].includes(health.code);
    await conn.query(`UPDATE channels SET status=?,chat_id=IF(?,?,chat_id),username=IF(?,?,username),title=IF(?,?,title),under_review=IF(?,1,under_review),health_checked_at=UTC_TIMESTAMP(6),
      health_status=CASE WHEN ? THEN 'healthy' WHEN status='rejected' THEN 'disabled' WHEN ? THEN 'critical' ELSE health_status END,
      health_failure_reason=CASE WHEN ? THEN NULL ELSE ? END,failure_reason=CASE WHEN ? THEN NULL WHEN ? THEN ? ELSE failure_reason END,
      paused_reason=CASE WHEN ? THEN NULL WHEN ? THEN ? ELSE paused_reason END,reactivated_at=CASE WHEN ? THEN UTC_TIMESTAMP(6) ELSE reactivated_at END,
      last_failure_at=CASE WHEN ? THEN NULL WHEN ? THEN UTC_TIMESTAMP(6) ELSE last_failure_at END WHERE id=?`,
      [desired.status, Boolean(chat && String(chat.id) !== String(channel.chat_id)), chat?.id || channel.chat_id, usernameChanged, username, titleChanged, title, manualReview,
        healthy && desired.status === "active", permanent, healthy, String(health.reason || health.code).slice(0, 500), healthy, permanent, String(health.reason || health.code).slice(0, 255),
        recovered, permanent, String(health.reason || health.code).slice(0, 255), recovered, healthy, permanent, channel.id]);
    await conn.query(`INSERT INTO channel_admin_action_audits(admin_id,action,channel_id,publisher_id,old_value,new_value,reason) VALUES(NULL,'telegram_identity_sync',?,?,?,?,?)`,
      [channel.id, channel.user_id, JSON.stringify(original), JSON.stringify({ status: desired.status, chat_id: target, username: usernameChanged ? username : channel.username, title, telegram_health: health.code, telegram_reason: health.reason, bot_member_status: member?.status || null }), desired.reason]);
    await conn.commit();
    if (recovered) totals.recovered += 1;
    if (usernameChanged || titleChanged || String(target) !== String(channel.chat_id)) totals.metadata_updated += 1;
  } catch (error) {
    await conn.rollback(); totals.manual_review += 1;
    console.warn("Channel identity sync skipped row", { channel_id: channel.id, error: error instanceof Error ? error.message : String(error) });
  } finally { conn.release(); }
}
console.log(JSON.stringify({ success: true, limit, request_gap_ms: gap, ...totals }));
await db.end();
