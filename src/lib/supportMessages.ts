import "server-only";

import { randomInt } from "crypto";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

export type SupportMessageType = "publisher_welcome" | "advertiser_onboarding";

type QueueRow = RowDataPacket & {
  id: number;
  user_id: number | null;
  telegram_user_id: string;
  username: string | null;
  first_name: string | null;
  message_type: SupportMessageType;
  template_version: number;
  retry_count: number;
};

type TemplateRow = RowDataPacket & {
  message_type: SupportMessageType;
  version: number;
  body: string;
};

type UserRow = RowDataPacket & {
  id: number;
  telegram_id: string | number | null;
  username: string | null;
  first_name: string | null;
};

type BackfillRunRow = RowDataPacket & {
  id: number;
  message_type: SupportMessageType;
  status: "running" | "paused" | "cancelled" | "completed" | "failed";
  total_eligible: number;
  queued_count: number;
  skip_permanently_failed: number;
  batch_size: number;
  last_user_id: number;
  started_at: string;
  paused_at: string | null;
  cancelled_at: string | null;
  completed_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  updated_at: string;
};

const SUPPORT_MESSAGE_TYPES = new Set<string>(["publisher_welcome", "advertiser_onboarding"]);
const SUPPORT_SENDER_ID = "AdsGalaxy Support";
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_BATCH_DELAY_SECONDS = 5;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKFILL_BATCH_SIZE = 100;

let supportClientPromise: Promise<TelegramClient> | null = null;

function clean(value: unknown) {
  return String(value || "").trim();
}

function numberEnv(key: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[key]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function publicBaseUrl() {
  return clean(process.env.NEXT_PUBLIC_APP_URL)
    || clean(process.env.NEXT_PUBLIC_ADSGALAXY_APP_URL)
    || clean(process.env.NEXT_PUBLIC_API_BASE_URL)
    || "https://adsgalaxy.online";
}

function docsLinks() {
  const base = publicBaseUrl().replace(/\/+$/, "");
  return {
    channel_docs_link: `${base}/docs/publisher/channels`,
    bot_docs_link: `${base}/docs/publisher/bots`,
    miniapp_docs_link: `${base}/docs/publisher/miniapps`,
    miniapp_ads_docs_link: `${base}/docs/advertiser/miniapps`,
    channel_ads_docs_link: `${base}/docs/advertiser/channels`,
    bot_ads_docs_link: `${base}/docs/advertiser/bots`,
  };
}

function renderTemplate(template: string, user: Pick<QueueRow, "first_name">) {
  const replacements: Record<string, string> = {
    first_name: clean(user.first_name) || "there",
    ...docsLinks(),
  };

  return template.replace(/\{\{([a-z_]+)\}\}/g, (_match, key: string) => replacements[key] || "");
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "unknown_error");
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

function safeErrorCode(error: unknown) {
  const message = safeErrorMessage(error);
  const upper = message.toUpperCase();
  if (upper.includes("FLOOD")) return "rate_limited";
  if (upper.includes("PEER_FLOOD")) return "peer_flood";
  if (upper.includes("USER_PRIVACY_RESTRICTED")) return "privacy_restricted";
  if (upper.includes("USER_IS_BLOCKED") || upper.includes("BLOCKED")) return "blocked";
  if (upper.includes("PEER_ID_INVALID") || upper.includes("USERNAME_INVALID")) return "invalid_recipient";
  if (upper.includes("AUTH_KEY") || upper.includes("SESSION") || upper.includes("AUTH")) return "session_auth_error";
  if (upper.includes("TIMEOUT") || upper.includes("ECONNRESET") || upper.includes("ETIMEDOUT")) return "network_error";
  return "telegram_send_error";
}

function isPermanentError(code: string) {
  return ["blocked", "privacy_restricted", "invalid_recipient", "session_auth_error"].includes(code);
}

function retryDelaySeconds(retryCount: number, code: string) {
  const base = code === "rate_limited" || code === "peer_flood" ? 900 : 300;
  return Math.min(86400, base * Math.max(1, 2 ** retryCount));
}

async function getSetting(key: string, fallback: string) {
  const [rows] = await pool.query<Array<RowDataPacket & { value: string | null }>>(
    "SELECT value FROM support_message_settings WHERE `key` = ? LIMIT 1",
    [key]
  );
  return clean(rows[0]?.value) || fallback;
}

async function setSetting(key: string, value: string, description: string) {
  await pool.query(
    `INSERT INTO support_message_settings (\`key\`, value, description)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), description = VALUES(description)`,
    [key, value, description]
  );
}

async function getActiveTemplate(messageType: SupportMessageType) {
  const [rows] = await pool.query<TemplateRow[]>(
    `SELECT message_type, version, body
     FROM support_message_templates
     WHERE message_type = ? AND is_active = 1
     ORDER BY version DESC
     LIMIT 1`,
    [messageType]
  );
  return rows[0] || null;
}

export async function queueSupportMessage(userId: number | string, messageType: SupportMessageType, conn?: PoolConnection) {
  if (!SUPPORT_MESSAGE_TYPES.has(messageType)) {
    throw new Error("Unsupported support message type");
  }

  const db = conn || pool;
  const [users] = await db.query<UserRow[]>(
    "SELECT id, telegram_id, username, first_name FROM users WHERE id = ? LIMIT 1",
    [userId]
  );
  const user = users[0];
  const telegramUserId = clean(user?.telegram_id);
  if (!user || !telegramUserId) {
    return { queued: false, reason: "missing_telegram_user_id" };
  }

  const template = await getActiveTemplate(messageType);
  const templateVersion = template?.version || 1;

  await db.query(
    `INSERT IGNORE INTO support_message_queue
      (user_id, telegram_user_id, username, first_name, message_type, template_version, status, next_attempt_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', NOW())`,
    [user.id, telegramUserId, clean(user.username) || null, clean(user.first_name) || null, messageType, templateVersion]
  );

  return { queued: true };
}

async function queueSupportMessageForUserRow(user: UserRow, messageType: SupportMessageType, conn?: PoolConnection, options: { retryPermanentlyFailed?: boolean } = {}) {
  const db = conn || pool;
  const telegramUserId = clean(user.telegram_id);
  if (!telegramUserId) return { queued: false, reason: "missing_telegram_user_id" };
  const template = await getActiveTemplate(messageType);
  const templateVersion = template?.version || 1;
  const [result] = options.retryPermanentlyFailed
    ? await db.query<ResultSetHeader>(
      `INSERT INTO support_message_queue
        (user_id, telegram_user_id, username, first_name, message_type, template_version, status, next_attempt_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', NOW())
       ON DUPLICATE KEY UPDATE
         next_attempt_at = IF(status = 'permanently_failed', NOW(), next_attempt_at),
         retry_count = IF(status = 'permanently_failed', 0, retry_count),
         failed_at = IF(status = 'permanently_failed', NULL, failed_at),
         last_error_code = IF(status = 'permanently_failed', NULL, last_error_code),
         last_error_message = IF(status = 'permanently_failed', NULL, last_error_message),
         status = IF(status = 'permanently_failed', 'queued', status)`,
      [user.id, telegramUserId, clean(user.username) || null, clean(user.first_name) || null, messageType, templateVersion]
    )
    : await db.query<ResultSetHeader>(
      `INSERT IGNORE INTO support_message_queue
        (user_id, telegram_user_id, username, first_name, message_type, template_version, status, next_attempt_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', NOW())`,
      [user.id, telegramUserId, clean(user.username) || null, clean(user.first_name) || null, messageType, templateVersion]
    );
  return { queued: result.affectedRows > 0 };
}

export async function queuePublisherWelcome(userId: number | string, conn?: PoolConnection) {
  return queueSupportMessage(userId, "publisher_welcome", conn);
}

export async function queueAdvertiserOnboarding(userId: number | string, conn?: PoolConnection) {
  return queueSupportMessage(userId, "advertiser_onboarding", conn);
}

export async function safeQueuePublisherWelcome(userId: number | string, conn?: PoolConnection) {
  try {
    return await queuePublisherWelcome(userId, conn);
  } catch (error) {
    console.warn("Support publisher welcome queue failed", { user_id: userId, error: safeErrorCode(error) });
    return { queued: false, reason: "queue_failed" };
  }
}

export async function safeQueueAdvertiserOnboarding(userId: number | string, conn?: PoolConnection) {
  try {
    return await queueAdvertiserOnboarding(userId, conn);
  } catch (error) {
    console.warn("Support advertiser onboarding queue failed", { user_id: userId, error: safeErrorCode(error) });
    return { queued: false, reason: "queue_failed" };
  }
}

function supportSenderConfig() {
  const enabled = clean(process.env.TELEGRAM_SUPPORT_SENDER_ENABLED).toLowerCase() === "true";
  const apiId = Number.parseInt(clean(process.env.TELEGRAM_SUPPORT_API_ID), 10);
  const apiHash = clean(process.env.TELEGRAM_SUPPORT_API_HASH);
  const session = clean(process.env.TELEGRAM_SUPPORT_SESSION);
  const missing: string[] = [];

  if (!enabled) missing.push("TELEGRAM_SUPPORT_SENDER_ENABLED");
  if (!Number.isFinite(apiId) || apiId <= 0) missing.push("TELEGRAM_SUPPORT_API_ID");
  if (!apiHash) missing.push("TELEGRAM_SUPPORT_API_HASH");
  if (!session) missing.push("TELEGRAM_SUPPORT_SESSION");

  if (missing.length > 0) return { ok: false as const, enabled, missing };
  return { ok: true as const, apiId, apiHash, session };
}

async function sendLimitState() {
  const maxPerHour = Number(await getSetting("support_messages_max_per_hour", clean(process.env.TELEGRAM_SUPPORT_MESSAGE_MAX_PER_HOUR) || "60")) || 60;
  const maxPerDay = Number(await getSetting("support_messages_max_per_day", clean(process.env.TELEGRAM_SUPPORT_MESSAGE_MAX_PER_DAY) || "300")) || 300;
  const [[hourRow]] = await pool.query<Array<RowDataPacket & { count: number }>>(
    "SELECT COUNT(*) AS count FROM support_message_delivery_log WHERE status = 'sent' AND dry_run = 0 AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)"
  );
  const [[dayRow]] = await pool.query<Array<RowDataPacket & { count: number }>>(
    "SELECT COUNT(*) AS count FROM support_message_delivery_log WHERE status = 'sent' AND dry_run = 0 AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)"
  );
  const hourSent = Number(hourRow?.count || 0);
  const daySent = Number(dayRow?.count || 0);
  return {
    max_per_hour: Math.max(1, Math.floor(maxPerHour)),
    max_per_day: Math.max(1, Math.floor(maxPerDay)),
    sent_last_hour: hourSent,
    sent_last_day: daySent,
    remaining_hour: Math.max(0, Math.max(1, Math.floor(maxPerHour)) - hourSent),
    remaining_day: Math.max(0, Math.max(1, Math.floor(maxPerDay)) - daySent),
  };
}

async function getSupportClient() {
  const config = supportSenderConfig();
  if (!config.ok) return config;

  if (!supportClientPromise) {
    supportClientPromise = (async () => {
      const client = new TelegramClient(new StringSession(config.session), config.apiId, config.apiHash, {
        connectionRetries: 1,
        reconnectRetries: 1,
        requestRetries: 1,
        retryDelay: 500,
        floodSleepThreshold: 0,
      });
      await client.connect();
      if (!(await client.checkAuthorization())) {
        throw new Error("support_session_unauthorized");
      }
      return client;
    })().catch((error) => {
      supportClientPromise = null;
      throw error;
    });
  }

  return { ok: true as const, client: await supportClientPromise };
}

async function sendSupportTelegramMessage(row: QueueRow, message: string) {
  const clientResult = await getSupportClient();
  if (!clientResult.ok) {
    return {
      ok: false as const,
      code: "sender_disabled",
      message: `Support sender disabled or missing configuration: ${clientResult.missing.join(", ")}`,
    };
  }

  const client = clientResult.client;
  const primaryRecipient = clean(row.telegram_user_id);
  const username = clean(row.username).replace(/^@/, "");

  try {
    await client.sendMessage(primaryRecipient, { message });
    return { ok: true as const, recipient: primaryRecipient };
  } catch (primaryError) {
    if (!username) throw primaryError;
    try {
      await client.sendMessage(username, { message });
      return { ok: true as const, recipient: username, username_fallback: true };
    } catch {
      throw primaryError;
    }
  }
}

async function recordDelivery(row: QueueRow, status: string, options: {
  dryRun?: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await pool.query(
    `INSERT INTO support_message_delivery_log
      (queue_id, telegram_user_id, username, message_type, template_version, status, dry_run, provider, sender_account, error_code, error_message, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'mtproto', ?, ?, ?, ?)`,
    [
      row.id,
      row.telegram_user_id,
      row.username,
      row.message_type,
      row.template_version,
      status,
      options.dryRun ? 1 : 0,
      SUPPORT_SENDER_ID,
      options.errorCode || null,
      options.errorMessage || null,
      options.metadata ? JSON.stringify(options.metadata) : null,
    ]
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function processSupportMessageQueue() {
  const backfill = await processActiveSupportBackfill();
  const paused = await getSetting("support_messages_paused", "1");
  const dryRun = await getSetting("support_messages_dry_run", "0") === "1";
  const batchSize = numberEnv("TELEGRAM_SUPPORT_MESSAGE_BATCH_SIZE", DEFAULT_BATCH_SIZE, 1, 25);
  const batchDelaySeconds = numberEnv("TELEGRAM_SUPPORT_MESSAGE_BATCH_DELAY_SECONDS", DEFAULT_BATCH_DELAY_SECONDS, 0, 60);
  const maxRetries = numberEnv("TELEGRAM_SUPPORT_MESSAGE_MAX_RETRIES", DEFAULT_MAX_RETRIES, 0, 10);

  if (paused === "1") {
    return { success: true, paused: true, processed: 0, sent: 0, failed: 0, retry_scheduled: 0, dry_run: dryRun, backfill };
  }

  const sender = supportSenderConfig();
  if (!dryRun && !sender.ok) {
    console.warn("Support sender disabled", { missing: sender.missing });
    return { success: true, paused: false, sender_disabled: true, missing: sender.missing, processed: 0, sent: 0, failed: 0, retry_scheduled: 0, dry_run: false, backfill };
  }

  const limits = await sendLimitState();
  const limitRemaining = dryRun ? batchSize : Math.min(batchSize, limits.remaining_hour, limits.remaining_day);
  if (limitRemaining <= 0) {
    return { success: true, paused: false, rate_limited: true, processed: 0, sent: 0, failed: 0, retry_scheduled: 0, dry_run: dryRun, limits, backfill };
  }

  const [rows] = await pool.query<QueueRow[]>(
    `SELECT id, user_id, telegram_user_id, username, first_name, message_type, template_version, retry_count
     FROM support_message_queue
     WHERE status IN ('queued','retry_scheduled')
       AND next_attempt_at <= NOW()
     ORDER BY next_attempt_at ASC, id ASC
     LIMIT ?`,
    [limitRemaining]
  );

  let sent = 0;
  let failed = 0;
  let retryScheduled = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const [claimResult] = await pool.query<ResultSetHeader>(
      `UPDATE support_message_queue
       SET status = 'sending', updated_at = NOW()
       WHERE id = ? AND status IN ('queued','retry_scheduled')`,
      [row.id]
    );
    if (claimResult.affectedRows !== 1) continue;

    const template = await getActiveTemplate(row.message_type);
    if (!template) {
      await pool.query(
        "UPDATE support_message_queue SET status = 'permanently_failed', failed_at = NOW(), last_error_code = 'template_missing', last_error_message = 'Active support template is missing' WHERE id = ?",
        [row.id]
      );
      await recordDelivery(row, "permanently_failed", { errorCode: "template_missing", errorMessage: "Active support template is missing" });
      failed += 1;
      continue;
    }

    const message = renderTemplate(template.body, row);
    await pool.query(
      "UPDATE support_message_queue SET rendered_message = ?, template_version = ?, sender_account = ? WHERE id = ?",
      [message, template.version, SUPPORT_SENDER_ID, row.id]
    );

    if (dryRun) {
      await pool.query(
        "UPDATE support_message_queue SET status = 'dry_run', sent_at = NULL, last_error_code = NULL, last_error_message = NULL WHERE id = ?",
        [row.id]
      );
      await recordDelivery(row, "dry_run", { dryRun: true, metadata: { rendered: true } });
      sent += 1;
      continue;
    }

    try {
      const result = await sendSupportTelegramMessage(row, message);
      if (!result.ok) throw new Error(result.message);
      await pool.query(
        "UPDATE support_message_queue SET status = 'sent', sent_at = NOW(), last_error_code = NULL, last_error_message = NULL WHERE id = ?",
        [row.id]
      );
      await recordDelivery(row, "sent", { metadata: { username_fallback: Boolean(result.username_fallback) } });
      sent += 1;
    } catch (error) {
      const code = safeErrorCode(error);
      const messageText = safeErrorMessage(error);
      const nextRetryCount = Number(row.retry_count || 0) + 1;
      const permanent = isPermanentError(code) || nextRetryCount > maxRetries;
      const nextStatus = permanent ? "permanently_failed" : "retry_scheduled";

      await pool.query(
        `UPDATE support_message_queue
         SET status = ?, failed_at = NOW(), retry_count = ?, next_attempt_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
             last_error_code = ?, last_error_message = ?
         WHERE id = ?`,
        [nextStatus, nextRetryCount, permanent ? 0 : retryDelaySeconds(nextRetryCount, code), code, messageText, row.id]
      );
      await recordDelivery(row, nextStatus, { errorCode: code, errorMessage: messageText });
      if (permanent) failed += 1;
      else retryScheduled += 1;
    }

    if (index < rows.length - 1 && batchDelaySeconds > 0) {
      await sleep(batchDelaySeconds * 1000 + randomInt(0, 750));
    }
  }

  return {
    success: true,
    paused: false,
    processed: rows.length,
    sent,
    failed,
    retry_scheduled: retryScheduled,
    dry_run: dryRun,
    limits,
    backfill,
  };
}

export async function getSupportMessageAdminSummary() {
  const [queueCounts] = await pool.query<Array<RowDataPacket & { status: string; count: number }>>(
    "SELECT status, COUNT(*) AS count FROM support_message_queue GROUP BY status"
  );
  const [settings] = await pool.query<Array<RowDataPacket & { key: string; value: string | null }>>(
    "SELECT `key`, value FROM support_message_settings WHERE `key` IN ('support_messages_paused','support_messages_dry_run','support_messages_max_per_hour','support_messages_max_per_day')"
  );
  const [recentDeliveries] = await pool.query<RowDataPacket[]>(
    `SELECT queue_id, telegram_user_id, username, message_type, status, dry_run, error_code, error_message, created_at
     FROM support_message_delivery_log
     ORDER BY created_at DESC
     LIMIT 25`
  );
  const [templates] = await pool.query<RowDataPacket[]>(
    "SELECT message_type, version, subject, is_active, updated_at FROM support_message_templates ORDER BY message_type, version DESC"
  );
  const settingMap = new Map(settings.map((row) => [row.key, clean(row.value)]));

  return {
    paused: settingMap.get("support_messages_paused") !== "0",
    dry_run: settingMap.get("support_messages_dry_run") === "1",
    max_per_hour: Number(settingMap.get("support_messages_max_per_hour") || 60),
    max_per_day: Number(settingMap.get("support_messages_max_per_day") || 300),
    queue_counts: Object.fromEntries(queueCounts.map((row) => [row.status, Number(row.count || 0)])),
    recent_deliveries: recentDeliveries,
    templates,
    backfill: await getSupportMessageBackfillProgress(),
    limits: await sendLimitState(),
  };
}

export async function setSupportMessagePaused(paused: boolean) {
  await setSetting("support_messages_paused", paused ? "1" : "0", "Global pause switch. 1 pauses all support-account sends.");
  return getSupportMessageAdminSummary();
}

export async function setSupportMessageDryRun(enabled: boolean) {
  await setSetting("support_messages_dry_run", enabled ? "1" : "0", "When 1, cron renders/logs messages without MTProto sending.");
  if (!enabled) {
    await pool.query(
      "UPDATE support_message_queue SET status = 'queued', next_attempt_at = NOW() WHERE status = 'dry_run'"
    );
  }
  return getSupportMessageAdminSummary();
}

export async function setSupportMessageRateLimits(input: { maxPerHour?: number; maxPerDay?: number }) {
  if (input.maxPerHour !== undefined) {
    await setSetting("support_messages_max_per_hour", String(Math.max(1, Math.floor(input.maxPerHour))), "Maximum real support-account sends per hour.");
  }
  if (input.maxPerDay !== undefined) {
    await setSetting("support_messages_max_per_day", String(Math.max(1, Math.floor(input.maxPerDay))), "Maximum real support-account sends per day.");
  }
  return getSupportMessageAdminSummary();
}

export async function renderSupportMessagePreview(messageType: SupportMessageType, userId?: number | string) {
  if (!SUPPORT_MESSAGE_TYPES.has(messageType)) throw new Error("Unsupported support message type");
  const template = await getActiveTemplate(messageType);
  if (!template) throw new Error("Active support template is missing");
  let firstName = "there";
  if (userId) {
    const [users] = await pool.query<UserRow[]>("SELECT first_name FROM users WHERE id = ? LIMIT 1", [userId]);
    firstName = clean(users[0]?.first_name) || firstName;
  }
  return {
    message_type: messageType,
    template_version: template.version,
    dry_run: true,
    message: renderTemplate(template.body, { first_name: firstName }),
  };
}

function eligibilityWhere(messageType: SupportMessageType) {
  if (messageType === "publisher_welcome") {
    return `u.telegram_id IS NOT NULL AND u.telegram_id <> ''
      AND (
        EXISTS (SELECT 1 FROM channels c WHERE c.user_id = u.id AND COALESCE(c.is_deleted, 0) = 0)
        OR EXISTS (SELECT 1 FROM bots b WHERE b.user_id = u.id AND COALESCE(b.is_deleted, 0) = 0)
        OR EXISTS (SELECT 1 FROM miniapps m WHERE m.user_id = u.id AND COALESCE(m.is_deleted, 0) = 0)
      )`;
  }
  return `u.telegram_id IS NOT NULL AND u.telegram_id <> ''
    AND (
      EXISTS (SELECT 1 FROM campaigns c WHERE c.user_id = u.id)
      OR EXISTS (SELECT 1 FROM miniapp_rewarded_campaigns mrc WHERE mrc.advertiser_id = u.id)
    )`;
}

async function countEligibleBackfillUsers(messageType: SupportMessageType, skipPermanentlyFailed: boolean) {
  const excludedStatusSql = skipPermanentlyFailed ? "" : "AND q.status <> 'permanently_failed'";
  const [rows] = await pool.query<Array<RowDataPacket & { count: number }>>(
    `SELECT COUNT(*) AS count
     FROM users u
     WHERE ${eligibilityWhere(messageType)}
       AND NOT EXISTS (
         SELECT 1 FROM support_message_queue q
         WHERE q.telegram_user_id = CAST(u.telegram_id AS CHAR)
           AND q.message_type = ?
           ${excludedStatusSql}
       )`,
    [messageType]
  );
  return Number(rows[0]?.count || 0);
}

export async function startSupportMessageBackfill(messageType: SupportMessageType, options: { batchSize?: number; skipPermanentlyFailed?: boolean } = {}) {
  if (!SUPPORT_MESSAGE_TYPES.has(messageType)) throw new Error("Unsupported support message type");
  const batchSize = Math.min(1000, Math.max(1, Math.floor(Number(options.batchSize || DEFAULT_BACKFILL_BATCH_SIZE))));
  const skipPermanentlyFailed = options.skipPermanentlyFailed !== false;
  const eligible = await countEligibleBackfillUsers(messageType, skipPermanentlyFailed);

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO support_message_backfill_runs
      (message_type, status, total_eligible, skip_permanently_failed, batch_size)
     VALUES (?, 'running', ?, ?, ?)`,
    [messageType, eligible, skipPermanentlyFailed ? 1 : 0, batchSize]
  );
  await processSupportBackfillRun(Number(result.insertId));
  return getSupportMessageBackfillProgress();
}

async function processSupportBackfillRun(runId: number) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [runs] = await conn.query<BackfillRunRow[]>(
      "SELECT * FROM support_message_backfill_runs WHERE id = ? AND status = 'running' FOR UPDATE",
      [runId]
    );
    const run = runs[0];
    if (!run) {
      await conn.rollback();
      return { processed: 0, queued: 0 };
    }

    const retryPermanentlyFailed = Number(run.skip_permanently_failed || 0) !== 1;
    const excludedStatusSql = retryPermanentlyFailed ? "AND q.status <> 'permanently_failed'" : "";
    const [users] = await conn.query<UserRow[]>(
      `SELECT u.id, u.telegram_id, u.username, u.first_name
       FROM users u
       WHERE u.id > ?
         AND ${eligibilityWhere(run.message_type)}
         AND NOT EXISTS (
           SELECT 1 FROM support_message_queue q
           WHERE q.telegram_user_id = CAST(u.telegram_id AS CHAR)
             AND q.message_type = ?
             ${excludedStatusSql}
         )
       ORDER BY u.id ASC
       LIMIT ?`,
      [run.last_user_id, run.message_type, Number(run.batch_size || DEFAULT_BACKFILL_BATCH_SIZE)]
    );

    let queued = 0;
    let lastUserId = Number(run.last_user_id || 0);
    for (const user of users) {
      lastUserId = Math.max(lastUserId, Number(user.id));
      const result = await queueSupportMessageForUserRow(user, run.message_type, conn, { retryPermanentlyFailed });
      if (result.queued) queued += 1;
    }

    const complete = users.length === 0;
    await conn.query(
      `UPDATE support_message_backfill_runs
       SET queued_count = queued_count + ?,
           last_user_id = ?,
           status = IF(? = 1, 'completed', status),
           completed_at = IF(? = 1, NOW(), completed_at),
           last_error_code = NULL,
           last_error_message = NULL
       WHERE id = ?`,
      [queued, lastUserId, complete ? 1 : 0, complete ? 1 : 0, run.id]
    );
    await conn.commit();
    return { processed: users.length, queued, completed: complete };
  } catch (error) {
    await conn.rollback();
    await pool.query(
      "UPDATE support_message_backfill_runs SET status = 'failed', last_error_code = ?, last_error_message = ? WHERE id = ?",
      [safeErrorCode(error), safeErrorMessage(error), runId]
    );
    return { processed: 0, queued: 0, error: safeErrorCode(error) };
  } finally {
    conn.release();
  }
}

export async function processActiveSupportBackfill() {
  const [runs] = await pool.query<BackfillRunRow[]>(
    "SELECT id FROM support_message_backfill_runs WHERE status = 'running' ORDER BY id ASC LIMIT 1"
  );
  if (!runs[0]) return { processed: 0, queued: 0 };
  return processSupportBackfillRun(Number(runs[0].id));
}

export async function updateSupportMessageBackfill(action: "pause" | "resume" | "cancel", runId?: number) {
  const idSql = runId ? "AND id = ?" : "";
  const params = runId ? [runId] : [];
  if (action === "pause") {
    await pool.query(`UPDATE support_message_backfill_runs SET status = 'paused', paused_at = NOW() WHERE status = 'running' ${idSql}`, params);
  } else if (action === "resume") {
    await pool.query(`UPDATE support_message_backfill_runs SET status = 'running', paused_at = NULL WHERE status = 'paused' ${idSql}`, params);
  } else {
    await pool.query(`UPDATE support_message_backfill_runs SET status = 'cancelled', cancelled_at = NOW() WHERE status IN ('running','paused') ${idSql}`, params);
  }
  return getSupportMessageBackfillProgress();
}

export async function getSupportMessageBackfillProgress() {
  const [runs] = await pool.query<BackfillRunRow[]>(
    "SELECT * FROM support_message_backfill_runs ORDER BY id DESC LIMIT 10"
  );
  const [queueCounts] = await pool.query<Array<RowDataPacket & { message_type: string; status: string; count: number }>>(
    "SELECT message_type, status, COUNT(*) AS count FROM support_message_queue GROUP BY message_type, status"
  );
  const counts = queueCounts.reduce<Record<string, Record<string, number>>>((acc, row) => {
    acc[row.message_type] ||= {};
    acc[row.message_type][row.status] = Number(row.count || 0);
    return acc;
  }, {});

  return runs.map((run) => {
    const byStatus = counts[run.message_type] || {};
    const remaining = Math.max(0, Number(run.total_eligible || 0) - Number(run.queued_count || 0));
    const batchSize = Math.max(1, Number(run.batch_size || DEFAULT_BACKFILL_BATCH_SIZE));
    return {
      id: run.id,
      message_type: run.message_type,
      status: run.status,
      total_eligible: Number(run.total_eligible || 0),
      queued: Number(run.queued_count || 0),
      sent: Number(byStatus.sent || 0),
      failed: Number(byStatus.failed || 0),
      retry_scheduled: Number(byStatus.retry_scheduled || 0),
      permanently_failed: Number(byStatus.permanently_failed || 0),
      dry_run: Number(byStatus.dry_run || 0),
      remaining,
      estimated_completion_batches: Math.ceil(remaining / batchSize),
      last_run_time: run.updated_at,
      last_telegram_error: run.last_error_message,
    };
  });
}
