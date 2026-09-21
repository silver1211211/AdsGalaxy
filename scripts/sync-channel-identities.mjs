import mysql from "mysql2/promise";
import "dotenv/config";
import {
  classifyRejectionHistory,
  classifyTelegramFailure,
  nextFailureState,
  recoveryDecision,
  retryDelayMs,
  technicalStatusForHealth,
  usernameUpdateAllowed,
} from "./channel-recovery-policy.mjs";

const db = await mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASS, database: process.env.DB_NAME, charset: "utf8mb4", connectionLimit: 2 });
if (!process.env.BOT_TOKEN) throw new Error("BOT_TOKEN_missing");
const limit = Math.min(5000, Math.max(1, Number(process.env.CHANNEL_IDENTITY_SYNC_LIMIT || 100)));
const gap = Math.min(2000, Math.max(80, Number(process.env.CHANNEL_IDENTITY_REQUEST_GAP_MS || 300)));
const reconcileAll = process.env.CHANNEL_IDENTITY_RECONCILE_ALL === "1";
const repairOnly = process.env.CHANNEL_IDENTITY_REPAIR_ONLY === "1";
const concurrency = Math.min(8, Math.max(1, Number(process.env.CHANNEL_IDENTITY_CONCURRENCY || (reconcileAll ? 6 : 2))));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nextRequestAt = 0;

async function telegram(method, payload) {
  let last;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const reservedAt = Math.max(Date.now(), nextRequestAt);
    nextRequestAt = reservedAt + gap;
    await sleep(Math.max(0, reservedAt - Date.now()));
    try {
      const response = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000) });
      last = await response.json();
      if (last?.ok) return last;
      if (response.status === 429 || last?.parameters?.retry_after) return last;
      return last;
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

const selectSql = `SELECT c.id,c.user_id,c.chat_id,c.username,c.title,c.channel_type,c.status,c.is_deleted,c.under_review,
  u.status publisher_status,u.is_banned,i.last_failure_code,i.consecutive_failure_count,
  i.last_failure_at identity_last_failure_at,i.last_checked_at,i.next_retry_at
  FROM channels c JOIN users u ON u.id=c.user_id
  LEFT JOIN channel_telegram_identities i ON i.channel_id=c.id WHERE c.is_deleted=FALSE`;
let channels;
if (reconcileAll) {
  [channels] = await db.query(`${selectSql}
    AND c.status IN ('channel_not_found','bot_removed','permission_missing','missing_chat_id')
    AND (i.last_check_source IS NULL OR i.last_check_source NOT IN ('chat_id','username','unresolved'))
    ORDER BY COALESCE(i.last_checked_at,'1970-01-01') ASC,c.id ASC LIMIT ?`, [limit]);
} else if (repairOnly) {
  [channels] = await db.query(`${selectSql}
    AND (c.chat_id IS NULL OR c.chat_id='' OR c.chat_id='0' OR c.username IS NULL OR c.username='' OR i.channel_id IS NULL)
    AND (i.next_retry_at IS NULL OR i.next_retry_at<=UTC_TIMESTAMP(6))
    ORDER BY CASE WHEN c.status='active' THEN 0 ELSE 1 END,COALESCE(i.last_checked_at,'1970-01-01') ASC,c.id ASC LIMIT ?`, [limit]);
} else {
  const activeLimit = Math.max(1, Math.ceil(limit * 0.7));
  const repairLimit = Math.max(0, limit - activeLimit);
  const [activeRows] = await db.query(`${selectSql}
    AND c.status='active'
    AND (i.next_retry_at IS NULL OR i.next_retry_at<=UTC_TIMESTAMP(6))
    AND (i.last_checked_at IS NULL OR i.last_checked_at<=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 24 HOUR))
    ORDER BY COALESCE(i.last_checked_at,'1970-01-01') ASC,c.id ASC LIMIT ?`, [activeLimit]);
  const [repairRows] = repairLimit ? await db.query(`${selectSql}
    AND c.status IN ('channel_not_found','bot_removed','permission_missing','missing_chat_id')
    AND (i.next_retry_at IS NULL OR i.next_retry_at<=UTC_TIMESTAMP(6))
    ORDER BY COALESCE(i.last_checked_at,'1970-01-01') ASC,c.id ASC LIMIT ?`, [repairLimit]) : [[]];
  channels = [...activeRows, ...repairRows];
}
const ids = channels.map(({ id }) => Number(id));
const [auditRows] = ids.length ? await db.query(`SELECT channel_id,action,old_value,created_at
  FROM channel_admin_action_audits
  WHERE channel_id IN (?) AND action IN ('reject','resume','bulk_approve','reinstate')
  ORDER BY channel_id,created_at`, [ids]) : [[]];
const history = new Map();
for (const audit of auditRows) {
  const channelId = Number(audit.channel_id);
  const channelHistory = history.get(channelId);
  if (channelHistory) channelHistory.push(audit);
  else history.set(channelId, [audit]);
}

const totals = { checked: 0, healthy: 0, recovered: 0, metadata_updated: 0, failed: 0, temporary: 0, manual_review: 0 };
async function processChannel(channel) {
  totals.checked += 1;
  if (totals.checked === 1 || totals.checked % 25 === 0) {
    console.log(JSON.stringify({ progress: totals.checked, total: channels.length, channel_id: Number(channel.id) }));
  }
  const original = { status: channel.status, chat_id: channel.chat_id == null ? null : String(channel.chat_id), username: channel.username, title: channel.title };
  const rejectionKind = classifyRejectionHistory(channel.status, history.get(Number(channel.id)) || []);
  const independentPolicyBlock = Boolean(channel.under_review || channel.is_banned || channel.publisher_status !== "active");
  let target = channel.chat_id && String(channel.chat_id) !== "0" ? String(channel.chat_id) : null;
  const storedUsername = normalizeUsername(channel.username);
  let chat = null;
  let member = null;
  let healthy = false;
  let health = { code: "temporary_error", reason: "Verification incomplete", permanent: false };

  if (target || storedUsername) {
    const [[duplicate]] = await db.query("SELECT id FROM channels WHERE is_deleted=FALSE AND chat_id=? AND id<>? LIMIT 1", [target, channel.id]);
    if (duplicate) health = { code: "duplicate_chat_id_manual_review", reason: "Permanent Telegram chat ID is assigned to multiple channel records.", permanent: false };
    else {
      let response = await telegram("getChat", { chat_id: target || ("@" + storedUsername) });
      if (!response?.ok && response?.parameters?.migrate_to_chat_id) {
        const migrated = String(response.parameters.migrate_to_chat_id);
        const [[collision]] = await db.query("SELECT id FROM channels WHERE is_deleted=FALSE AND chat_id=? AND id<>? LIMIT 1", [migrated, channel.id]);
        if (!collision) { target = migrated; response = await telegram("getChat", { chat_id: target }); }
        else health = { code: "migrated_chat_id_collision", reason: "Migrated Telegram chat ID belongs to another stored channel.", permanent: false };
      }
      if (!response?.ok && target && storedUsername) {
        const usernameResponse = await telegram("getChat", { chat_id: "@" + storedUsername });
        if (usernameResponse?.ok) {
          response = usernameResponse;
        }
      }
      if (!response?.ok) health = classifyTelegramFailure(response);
      else {
        chat = response.result;
        target = String(chat.id);
        const [[collision]] = await db.query("SELECT id FROM channels WHERE is_deleted=FALSE AND chat_id=? AND id<>? LIMIT 1", [target, channel.id]);
        if (collision) {
          health = { code: "resolved_chat_id_collision", reason: "Resolved Telegram chat ID belongs to another channel record.", permanent: false };
          chat = null;
        }
      }
      if (chat) {
        response = await telegram("getChatMember", { chat_id: chat.id, user_id: me.result.id });
        if (!response?.ok) health = classifyTelegramFailure(response);
        else {
          member = response.result;
          const status = String(member.status || "unknown");
          const canPost = status === "creator" || (status === "administrator" && member.can_post_messages !== false);
          if (status === "left" || status === "kicked") health = { code: "bot_removed", reason: "Ads Galaxy bot membership is " + status + ".", permanent: true };
          else if (!canPost) health = { code: "permission_missing", reason: "Ads Galaxy bot status is " + status + " without posting permission.", permanent: true };
          else { healthy = true; health = { code: "healthy", reason: null, permanent: false }; }
        }
      }
    }
  } else {
    health = { code: "missing_chat_id", reason: "No Telegram chat_id or username is stored.", permanent: true };
  }

  const failureState = nextFailureState({
    previousCode: channel.last_failure_code,
    previousCount: channel.consecutive_failure_count,
    previousFailureAt: channel.identity_last_failure_at,
    health,
  });
  const desired = recoveryDecision({ currentStatus: channel.status, telegramHealthy: healthy, rejectionKind, independentPolicyBlock });
  if (!healthy && failureState.demote && !["rejected", "pending", "paused"].includes(desired.status) && rejectionKind === "none" && !independentPolicyBlock) {
    desired.status = technicalStatusForHealth(health.code);
    desired.reason = health.code + "_confirmed_after_" + failureState.count + "_independent_failures";
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
    if (!health.code.includes("collision")) await conn.query(`INSERT INTO channel_telegram_identities
      (channel_id,telegram_chat_id,channel_type,current_username,bot_member_status,bot_can_post,
       last_verified_at,last_success_at,last_checked_at,verification_state,consecutive_failure_count,
       first_failure_at,last_failure_at,next_retry_at,last_failure_code,last_failure_reason,last_check_source)
      VALUES (?,?,?,?,?,?,IF(?,UTC_TIMESTAMP(6),NULL),IF(?,UTC_TIMESTAMP(6),NULL),UTC_TIMESTAMP(6),?,?,
       IF(?=1,UTC_TIMESTAMP(6),NULL),IF(?,UTC_TIMESTAMP(6),NULL),?,?,?,?)
      ON DUPLICATE KEY UPDATE telegram_chat_id=VALUES(telegram_chat_id),channel_type=VALUES(channel_type),
      previous_username=IF(NOT(current_username<=>VALUES(current_username)),current_username,previous_username),
      last_username_changed_at=IF(NOT(current_username<=>VALUES(current_username)),UTC_TIMESTAMP(6),last_username_changed_at),
      current_username=VALUES(current_username),bot_member_status=VALUES(bot_member_status),bot_can_post=VALUES(bot_can_post),
      last_checked_at=VALUES(last_checked_at),verification_state=VALUES(verification_state),last_check_source=VALUES(last_check_source),
      last_verified_at=IF(VALUES(bot_can_post)=1,UTC_TIMESTAMP(6),last_verified_at),
      last_success_at=IF(VALUES(bot_can_post)=1,UTC_TIMESTAMP(6),last_success_at),
      consecutive_failure_count=IF(VALUES(bot_can_post)=1,0,VALUES(consecutive_failure_count)),
      first_failure_at=IF(VALUES(bot_can_post)=1,NULL,IF(VALUES(consecutive_failure_count)=1,UTC_TIMESTAMP(6),COALESCE(first_failure_at,UTC_TIMESTAMP(6)))),
      last_failure_at=IF(VALUES(bot_can_post)=1,NULL,UTC_TIMESTAMP(6)),
      next_retry_at=IF(VALUES(bot_can_post)=1,NULL,VALUES(next_retry_at)),
      last_failure_code=IF(VALUES(bot_can_post)=1,NULL,VALUES(last_failure_code)),
      last_failure_reason=IF(VALUES(bot_can_post)=1,NULL,VALUES(last_failure_reason))`,
      [channel.id, target, channel.channel_type === "private" ? "private" : "public", username,
        member?.status || null, healthy ? 1 : 0, healthy ? 1 : 0, healthy ? 1 : 0,
        healthy ? "healthy" : health.code, healthy ? 0 : failureState.count,
        healthy ? 0 : failureState.count, healthy ? 0 : failureState.count > Number(channel.consecutive_failure_count || 0),
        failureState.nextRetryAt, healthy ? null : health.code,
        healthy ? null : String(health.reason || health.code).slice(0, 500),
        chat ? (String(chat.id) === String(channel.chat_id || "") ? "chat_id" : "username") : "unresolved"]);
    const recovered = desired.status === "active" && channel.status !== "active";
    const permanent = failureState.demote;
    await conn.query(`UPDATE channels SET status=?,chat_id=IF(?,?,chat_id),username=IF(?,?,username),title=IF(?,?,title),under_review=IF(?,1,under_review),health_checked_at=UTC_TIMESTAMP(6),
      health_status=CASE WHEN ? THEN 'healthy' WHEN status='rejected' THEN 'disabled' WHEN ? THEN 'critical' ELSE health_status END,
      health_failure_reason=CASE WHEN ? THEN NULL ELSE ? END,failure_reason=CASE WHEN ? THEN NULL WHEN ? THEN ? ELSE failure_reason END,
      paused_reason=CASE WHEN ? THEN NULL WHEN ? THEN ? ELSE paused_reason END,reactivated_at=CASE WHEN ? THEN UTC_TIMESTAMP(6) ELSE reactivated_at END,
      last_failure_at=CASE WHEN ? THEN NULL WHEN ? THEN UTC_TIMESTAMP(6) ELSE last_failure_at END WHERE id=?`,
      [desired.status, Boolean(chat && String(chat.id) !== String(channel.chat_id)), chat?.id || channel.chat_id, usernameChanged, username, titleChanged, title, manualReview,
        healthy && desired.status === "active", permanent, healthy, String(health.reason || health.code).slice(0, 500), healthy, permanent, String(health.reason || health.code).slice(0, 255),
        recovered, permanent, String(health.reason || health.code).slice(0, 255), recovered, healthy, permanent, channel.id]);
    if (recovered || desired.status !== channel.status || usernameChanged || titleChanged || String(target) !== String(channel.chat_id)) {
      await conn.query(`INSERT INTO channel_admin_action_audits(admin_id,action,channel_id,publisher_id,old_value,new_value,reason) VALUES(NULL,'telegram_identity_sync',?,?,?,?,?)`,
        [channel.id, channel.user_id, JSON.stringify(original), JSON.stringify({ status: desired.status, chat_id: target,
          username: usernameChanged ? username : channel.username, title, telegram_health: health.code,
          telegram_reason: health.reason, bot_member_status: member?.status || null,
          independent_failure_count: failureState.count }), desired.reason]);
    }
    await conn.commit();
    if (recovered) totals.recovered += 1;
    if (usernameChanged || titleChanged || String(target) !== String(channel.chat_id)) totals.metadata_updated += 1;
  } catch (error) {
    await conn.rollback(); totals.manual_review += 1;
    console.warn("Channel identity sync skipped row", { channel_id: channel.id, error: error instanceof Error ? error.message : String(error) });
  } finally { conn.release(); }
}

let cursor = 0;
async function worker() {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= channels.length) return;
    await processChannel(channels[index]);
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, channels.length)) }, () => worker()));
console.log(JSON.stringify({ success: true, mode: reconcileAll ? "reconcile_all" : repairOnly ? "repair_only" : "scheduled", limit, request_gap_ms: gap, concurrency, ...totals }));
await db.end();
