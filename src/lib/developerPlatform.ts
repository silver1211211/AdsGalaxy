import crypto from "crypto";
import type { PoolConnection } from "mysql2/promise";
import pool from "@/lib/db";

export type DeveloperPermission =
  | "read_only"
  | "reporting"
  | "reward_validation"
  | "conversion_tracking"
  | "full_access";

type Db = typeof pool | PoolConnection;

const DEFAULT_PERMISSIONS: DeveloperPermission[] = ["read_only", "reporting"];
const ALL_PERMISSIONS: DeveloperPermission[] = ["read_only", "reporting", "reward_validation", "conversion_tracking", "full_access"];

function clean(value: unknown) {
  return String(value || "").trim();
}

function hashKey(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function randomToken(prefix: string) {
  return `${prefix}_${crypto.randomBytes(24).toString("base64url")}`;
}

function toInt(value: unknown, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseJsonArray<T>(value: unknown, fallback: T[] = []) {
  if (Array.isArray(value)) return value as T[];
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseList(value: unknown) {
  return clean(value)
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePermissions(value: unknown) {
  const raw = parseJsonArray<string>(value, Array.isArray(value) ? value as string[] : DEFAULT_PERMISSIONS);
  const permissions = raw.filter((permission): permission is DeveloperPermission => ALL_PERMISSIONS.includes(permission as DeveloperPermission));
  return permissions.length > 0 ? permissions : DEFAULT_PERMISSIONS;
}

function hasPermission(actual: DeveloperPermission[], required: DeveloperPermission) {
  return actual.includes("full_access") || actual.includes(required) || required === "read_only";
}

function requestIp(request: Request) {
  return clean(request.headers.get("x-forwarded-for")?.split(",")[0]) || "127.0.0.1";
}

function requestOrigin(request: Request) {
  const value = clean(request.headers.get("origin") || request.headers.get("referer"));
  if (!value) return "";
  try { return new URL(value).origin.toLowerCase(); } catch { return ""; }
}

function normalizedAllowedOrigin(value: string) {
  try { return new URL(value).origin.toLowerCase(); } catch { return ""; }
}

function validatedWebhookUrl(value: unknown) {
  const raw = clean(value);
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Webhook URL must be valid HTTPS"); }
  const host = url.hostname.toLowerCase();
  const privateHost = host === "localhost" || host === "127.0.0.1" || host === "::1"
    || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || /^169\.254\./.test(host);
  if (url.protocol !== "https:" || privateHost || !host.includes(".")) throw new Error("Webhook URL must be a public HTTPS endpoint");
  url.username = ""; url.password = ""; url.hash = "";
  return url.toString();
}

async function getSettings(db: Db = pool) {
  const [rows]: any = await db.query("SELECT `key`, value FROM developer_platform_settings");
  return new Map<string, string>(rows.map((row: any) => [String(row.key), String(row.value)]));
}

function settingNumber(settings: Map<string, string>, key: string, fallback: number) {
  return Math.max(1, toInt(settings.get(key), fallback));
}

function integrationIdFor(applicationId: number, mode: "sandbox" | "production") {
  const seed = `${mode}:${applicationId}:adsgalaxy-integration`;
  const digest = crypto.createHash("sha256").update(seed).digest("hex");
  return String(100000 + (Number.parseInt(digest.slice(0, 10), 16) % 99900000));
}

function withIntegrationIds(app: any) {
  return {
    ...app,
    integration_id: integrationIdFor(Number(app.id), String(app.mode || "sandbox") === "production" ? "production" : "sandbox"),
    sandbox_integration_id: integrationIdFor(Number(app.id), "sandbox"),
    production_integration_id: integrationIdFor(Number(app.id), "production"),
  };
}

export async function createDeveloperApplication(userId: number, input: {
  name?: unknown;
  platform?: unknown;
  mode?: unknown;
  permissions?: unknown;
  allowedIps?: unknown;
  allowedOrigins?: unknown;
  webhookUrl?: unknown;
}) {
  const permissions = normalizePermissions(input.permissions);
  const webhookSecret = randomToken("whsec");
  const [result]: any = await pool.query(
    `INSERT INTO developer_applications
      (user_id, name, platform, mode, permissions, allowed_ips, allowed_origins, webhook_url, webhook_secret)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      clean(input.name) || "AdsGalaxy App",
      clean(input.platform) || "telegram_mini_app",
      clean(input.mode) === "production" ? "production" : "sandbox",
      JSON.stringify(permissions),
      clean(input.allowedIps),
      clean(input.allowedOrigins),
      clean(input.webhookUrl) ? validatedWebhookUrl(input.webhookUrl) : null,
      webhookSecret,
    ]
  );
  await generateDeveloperApiKey(Number(result.insertId), userId, "public", permissions);
  const privateKey = await generateDeveloperApiKey(Number(result.insertId), userId, "private", permissions);
  return { application_id: Number(result.insertId), private_key: privateKey.raw_key };
}

export async function generateDeveloperApiKey(applicationId: number, userId: number, keyType: "public" | "private", permissions: DeveloperPermission[] = DEFAULT_PERMISSIONS) {
  const rawKey = randomToken(keyType === "public" ? "agx_pub_v1" : "agx_priv_v1");
  const [result]: any = await pool.query(
    `INSERT INTO developer_api_keys
      (application_id, user_id, key_type, key_prefix, key_hash, permissions)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [applicationId, userId, keyType, rawKey.slice(0, 18), hashKey(rawKey), JSON.stringify(permissions)]
  );
  return { id: Number(result.insertId), raw_key: rawKey, key_prefix: rawKey.slice(0, 18) };
}

export async function getDeveloperDashboard(userId: number) {
  const [apps]: any = await pool.query(
    `SELECT a.*,
       COUNT(k.id) as key_count,
       SUM(CASE WHEN k.status = 'active' THEN 1 ELSE 0 END) as active_keys
     FROM developer_applications a
     LEFT JOIN developer_api_keys k ON k.application_id = a.id
     WHERE a.user_id = ?
     GROUP BY a.id
     ORDER BY a.created_at DESC`,
    [userId]
  );
  const [keys]: any = await pool.query(
    "SELECT id, application_id, key_type, key_prefix, status, permissions, last_used_at, created_at FROM developer_api_keys WHERE user_id = ? ORDER BY created_at DESC",
    [userId]
  );
  const [webhooks]: any = await pool.query(
    "SELECT id, application_id, url, events, status, created_at FROM developer_webhooks WHERE user_id = ? ORDER BY created_at DESC",
    [userId]
  );
  const [deliveries]: any = await pool.query(
    `SELECT d.*
     FROM developer_webhook_deliveries d
     JOIN developer_applications a ON a.id = d.application_id
     WHERE a.user_id = ?
     ORDER BY d.created_at DESC
     LIMIT 50`,
    [userId]
  );
  const [analytics]: any = await pool.query(
    `SELECT
       COUNT(*) as requests,
       SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
       SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors,
       SUM(CASE WHEN endpoint LIKE '%reward%' THEN 1 ELSE 0 END) as reward_validations
     FROM developer_api_requests
     WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
    [userId]
  );
  const [eventAnalytics]: any = await pool.query(
    `SELECT
       SUM(CASE WHEN event_type IN ('ad_requested', 'rewarded_requested') THEN 1 ELSE 0 END) as ad_requests,
       SUM(CASE WHEN event_type = 'ad_impression' THEN 1 ELSE 0 END) as impressions,
       SUM(CASE WHEN event_type = 'ad_completion' THEN 1 ELSE 0 END) as completions
     FROM developer_sandbox_events
     WHERE application_id IN (SELECT id FROM developer_applications WHERE user_id = ?)
       AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
    [userId]
  );
  const [miniapps]: any = await pool.query(
    `SELECT id, miniapp_name, miniapp_username, status
     FROM miniapps
     WHERE user_id = ? AND is_deleted = FALSE
     ORDER BY created_at DESC`,
    [userId]
  );
  const [bindings]: any = await pool.query(
    `SELECT dam.id, dam.application_id, dam.miniapp_id, dam.environment, dam.status,
            m.miniapp_name, m.miniapp_username
     FROM developer_application_miniapps dam
     JOIN developer_applications a ON a.id = dam.application_id AND a.user_id = ?
     JOIN miniapps m ON m.id = dam.miniapp_id
     ORDER BY dam.created_at DESC`,
    [userId]
  );
  const errors = Number(analytics[0]?.errors || 0);
  return {
    apps: apps.map((app: any) => withIntegrationIds({ ...app, permissions: parseJsonArray(app.permissions) })),
    keys: keys.map((key: any) => ({ ...key, permissions: parseJsonArray(key.permissions) })),
    webhooks: webhooks.map((webhook: any) => ({ ...webhook, events: parseJsonArray(webhook.events) })),
    deliveries,
    miniapps,
    bindings,
    analytics: {
      ...(analytics[0] || {}),
      ad_requests: Number(eventAnalytics[0]?.ad_requests || 0),
      impressions: Number(eventAnalytics[0]?.impressions || 0),
      completions: Number(eventAnalytics[0]?.completions || 0),
      fill_rate: Number(eventAnalytics[0]?.ad_requests || 0) > 0
        ? Number(eventAnalytics[0]?.impressions || 0) / Number(eventAnalytics[0]?.ad_requests || 1) * 100
        : 0,
      errors,
      revenue: 0,
    },
  };
}

export async function getAdminDeveloperPlatformData() {
  const [settings]: any = await pool.query("SELECT `key`, value, description FROM developer_platform_settings ORDER BY `key`");
  const [apps]: any = await pool.query(
    `SELECT a.*, u.username, u.telegram_id, COUNT(k.id) as key_count
     FROM developer_applications a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN developer_api_keys k ON k.application_id = a.id
     GROUP BY a.id
     ORDER BY a.created_at DESC
     LIMIT 100`
  );
  const [analytics]: any = await pool.query(
    `SELECT
       COUNT(*) as requests,
       SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
       SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors,
       COUNT(DISTINCT application_id) as active_apps,
       SUM(CASE WHEN endpoint LIKE '%webhook%' THEN 1 ELSE 0 END) as webhook_deliveries,
       SUM(CASE WHEN endpoint LIKE '%reward%' THEN 1 ELSE 0 END) as reward_validations
     FROM developer_api_requests
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
  );
  const [requests]: any = await pool.query("SELECT * FROM developer_api_requests ORDER BY created_at DESC LIMIT 100");
  const [deliveries]: any = await pool.query("SELECT * FROM developer_webhook_deliveries ORDER BY created_at DESC LIMIT 100");
  return { settings, apps, analytics: analytics[0] || {}, requests, deliveries };
}

export async function validateDeveloperApiRequest(
  request: Request,
  requiredPermission: DeveloperPermission,
  endpoint: string,
  options: {
    requiredKeyType?: "public" | "private";
    enforceKeyTypeForMode?: "sandbox" | "production";
  } = {}
) {
  const apiKey = clean(request.headers.get("x-api-key") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
  if (!apiKey) {
    throw Object.assign(new Error("API key required"), { statusCode: 401 });
  }

  const [rows]: any = await pool.query(
    `SELECT k.*, a.status as app_status, a.mode as app_mode, a.allowed_ips as app_allowed_ips, a.allowed_origins as app_allowed_origins
     FROM developer_api_keys k
     JOIN developer_applications a ON a.id = k.application_id
     WHERE k.key_hash = ?
     LIMIT 1`,
    [hashKey(apiKey)]
  );
  const record = rows[0];
  if (!record || record.status !== "active" || record.app_status !== "active") {
    throw Object.assign(new Error("API key disabled or invalid"), { statusCode: 403 });
  }
  if (
    options.requiredKeyType
    && (!options.enforceKeyTypeForMode || String(record.app_mode) === options.enforceKeyTypeForMode)
    && record.key_type !== options.requiredKeyType
  ) {
    throw Object.assign(new Error(`${options.requiredKeyType} API key required`), {
      statusCode: 403,
      errorCode: "INVALID_API_KEY_TYPE",
    });
  }

  const permissions = normalizePermissions(record.permissions);
  if (!hasPermission(permissions, requiredPermission)) {
    throw Object.assign(new Error("API key lacks required permission"), { statusCode: 403 });
  }

  const ip = requestIp(request);
  const origin = requestOrigin(request);
  const allowedIps = parseList(record.allowed_ips || record.app_allowed_ips);
  const allowedOrigins = parseList(record.allowed_origins || record.app_allowed_origins);
  if (allowedIps.length > 0 && !allowedIps.includes(ip)) {
    throw Object.assign(new Error("IP address is not allowed for this key"), { statusCode: 403 });
  }
  if (allowedOrigins.length > 0) {
    const normalizedOrigins = allowedOrigins.map(normalizedAllowedOrigin).filter(Boolean);
    if (!origin || !normalizedOrigins.includes(origin)) {
      throw Object.assign(new Error("Origin is not allowed for this key"), { statusCode: 403 });
    }
  }

  const settings = await getSettings();
  const limits = [
    ["MINUTE", settingNumber(settings, "rate_limit_per_minute", 100)],
    ["HOUR", settingNumber(settings, "rate_limit_per_hour", 1000)],
    ["DAY", settingNumber(settings, "rate_limit_per_day", 10000)],
  ] as const;
  for (const [unit, limit] of limits) {
    const [[countRow]]: any = await pool.query(
      `SELECT COUNT(*) as count FROM developer_api_requests WHERE api_key_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 ${unit})`,
      [record.id]
    );
    if (toInt(countRow?.count) >= limit) {
      throw Object.assign(new Error(`Rate limit exceeded: ${limit} requests per ${unit.toLowerCase()}`), { statusCode: 429 });
    }
  }

  await pool.query("UPDATE developer_api_keys SET last_used_at = NOW() WHERE id = ?", [record.id]);
  return {
    applicationId: Number(record.application_id),
    apiKeyId: Number(record.id),
    keyType: String(record.key_type) as "public" | "private",
    userId: Number(record.user_id),
    mode: String(record.app_mode || "sandbox"),
    endpoint,
    permission: requiredPermission,
    ip,
    origin,
  };
}

export async function logDeveloperApiRequest(context: any, request: Request, statusCode: number, success: boolean, metadata?: Record<string, unknown>, errorMessage?: string) {
  await pool.query(
    `INSERT INTO developer_api_requests
      (application_id, api_key_id, user_id, endpoint, method, status_code, success, mode, permission_used, ip_address, origin, user_agent, request_id, error_message, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      context?.applicationId || null,
      context?.apiKeyId || null,
      context?.userId || null,
      context?.endpoint || "unknown",
      request.method,
      statusCode,
      success ? 1 : 0,
      context?.mode || "sandbox",
      context?.permission || null,
      context?.ip || requestIp(request),
      context?.origin || requestOrigin(request),
      request.headers.get("user-agent") || null,
      metadata?.request_id || null,
      errorMessage || null,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
}

export async function recordSandboxEvent(applicationId: number, eventType: string, payload: Record<string, unknown>) {
  await pool.query(
    "INSERT INTO developer_sandbox_events (application_id, event_type, external_user_id, request_id, payload) VALUES (?, ?, ?, ?, ?)",
    [applicationId, eventType, clean(payload.external_user_id), clean(payload.request_id), JSON.stringify(payload)]
  );
}

export async function enqueueDeveloperWebhook(applicationId: number, eventType: string, payload: Record<string, unknown>) {
  const [webhooks]: any = await pool.query(
    "SELECT * FROM developer_webhooks WHERE application_id = ? AND status = 'active'",
    [applicationId]
  );
  for (const webhook of webhooks) {
    const events = parseJsonArray<string>(webhook.events);
    if (!events.includes(eventType) && !events.includes("*")) continue;
    await pool.query(
      `INSERT INTO developer_webhook_deliveries
        (webhook_id, application_id, event_type, payload, status, next_attempt_at)
       VALUES (?, ?, ?, ?, 'pending', NOW())`,
      [webhook.id, applicationId, eventType, JSON.stringify(payload)]
    );
  }
}

type ProductionRewardEvent = {
  id: number;
  event_id: string;
  request_id: string;
  miniapp_id: number;
  external_user_reference: string | null;
  provider: string;
  status: string;
  verification_level: string;
  reward_eligible: number | boolean;
  completed_at: Date | string;
  expires_at: Date | string;
};

function webhookIso(value: Date | string) {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export async function enqueueProductionRewardWebhook(input: {
  db: PoolConnection;
  applicationId: number;
  eventType: "reward.eligible" | "reward.claimed";
  event: ProductionRewardEvent;
  claim?: { claim_id: string; claimed_at: string };
}) {
  const [webhooks]: any = await input.db.query(
    "SELECT id, events, secret, secret_version FROM developer_webhooks WHERE application_id = ? AND status = 'active'",
    [input.applicationId]
  );
  const payload = {
    id: input.event.event_id,
    type: input.eventType,
    version: "2026-07-28",
    created_at: input.eventType === "reward.claimed" && input.claim
      ? input.claim.claimed_at
      : webhookIso(input.event.completed_at),
    data: {
      event_id: input.event.event_id,
      request_id: input.event.request_id,
      mini_app_id: Number(input.event.miniapp_id),
      external_user_reference: input.event.external_user_reference,
      provider: input.event.provider,
      status: input.event.status,
      verification_level: input.event.verification_level,
      reward_eligible: Boolean(input.event.reward_eligible),
      completed_at: webhookIso(input.event.completed_at),
      expires_at: webhookIso(input.event.expires_at),
      ...(input.claim ? {
        claim_id: input.claim.claim_id,
        claimed_at: input.claim.claimed_at,
      } : {}),
    },
  };
  for (const webhook of webhooks) {
    const events = parseJsonArray<string>(webhook.events);
    if (!events.includes(input.eventType) && !events.includes("*")) continue;
    const logicalKey = `auto:${webhook.id}:${input.event.event_id}:${input.eventType}`;
    await input.db.query(
      `INSERT IGNORE INTO developer_webhook_deliveries
        (webhook_id, application_id, event_type, event_id, webhook_version,
         signature_version, secret_version, signing_secret, logical_delivery_key,
         payload, status, next_attempt_at)
       VALUES (?, ?, ?, ?, 'v2', 'v2', ?, ?, ?, ?, 'pending', NOW())`,
      [
        webhook.id,
        input.applicationId,
        input.eventType,
        input.event.event_id,
        Number(webhook.secret_version || 1),
        String(webhook.secret),
        logicalKey,
        JSON.stringify(payload),
      ]
    );
  }
}

export async function saveDeveloperWebhook(userId: number, input: { applicationId: number; url?: unknown; events?: unknown }) {
  const [apps]: any = await pool.query("SELECT id FROM developer_applications WHERE id = ? AND user_id = ?", [input.applicationId, userId]);
  if (apps.length === 0) throw new Error("Application not found");
  const secret = randomToken("whsec");
  await pool.query(
    "INSERT INTO developer_webhooks (application_id, user_id, url, secret, events) VALUES (?, ?, ?, ?, ?)",
    [input.applicationId, userId, validatedWebhookUrl(input.url), secret, JSON.stringify(parseJsonArray(input.events, ["*"]))]
  );
  return { secret };
}

export async function resetDeveloperApiKey(keyId: number, userId: number) {
  const [rows]: any = await pool.query("SELECT * FROM developer_api_keys WHERE id = ? AND user_id = ?", [keyId, userId]);
  if (rows.length === 0) throw new Error("API key not found");
  const rawKey = randomToken(rows[0].key_type === "public" ? "agx_pub_v1" : "agx_priv_v1");
  await pool.query("UPDATE developer_api_keys SET key_prefix = ?, key_hash = ?, status = 'active', disabled_at = NULL WHERE id = ?", [rawKey.slice(0, 18), hashKey(rawKey), keyId]);
  return { raw_key: rawKey, key_prefix: rawKey.slice(0, 18) };
}

const V2_RETRY_DELAYS_MINUTES = [1, 5, 15, 60, 360] as const;
const MAX_WEBHOOK_RESPONSE_BYTES = 64 * 1024;

export async function claimWebhookDeliveryBatch() {
  const conn = await pool.getConnection();
  const token = crypto.randomBytes(24).toString("hex");
  try {
    await conn.beginTransaction();
    const [rows]: any = await conn.query(
      `SELECT id
       FROM developer_webhook_deliveries
       WHERE status IN ('pending', 'retrying')
         AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
         AND (claim_expires_at IS NULL OR claim_expires_at <= NOW())
       ORDER BY created_at ASC
       LIMIT 25
       FOR UPDATE`
    );
    const ids = rows.map((row: any) => Number(row.id)).filter(Boolean);
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      await conn.query(
        `UPDATE developer_webhook_deliveries
         SET claim_token = ?, claimed_at = NOW(), claim_expires_at = DATE_ADD(NOW(), INTERVAL 5 MINUTE)
         WHERE id IN (${placeholders})`,
        [token, ...ids]
      );
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    conn.release();
  }
  const [claimed]: any = await pool.query(
    `SELECT d.*, w.url, w.secret, w.previous_secret, w.previous_secret_version,
            w.previous_secret_expires_at
     FROM developer_webhook_deliveries d
     JOIN developer_webhooks w ON w.id = d.webhook_id
     WHERE d.claim_token = ?`,
    [token]
  );
  return { token, deliveries: claimed };
}

function deliverySecret(delivery: any) {
  if (delivery.signing_secret) return String(delivery.signing_secret);
  if (
    Number(delivery.secret_version) === Number(delivery.previous_secret_version)
    && delivery.previous_secret
    && delivery.previous_secret_expires_at
    && new Date(delivery.previous_secret_expires_at).getTime() > Date.now()
  ) {
    return String(delivery.previous_secret);
  }
  return String(delivery.secret);
}

export async function hashBoundedWebhookResponse(
  response: Response,
  maxBytes = MAX_WEBHOOK_RESPONSE_BYTES
) {
  const hash = crypto.createHash("sha256");
  if (!response.body) {
    return { hash: `sha256:${hash.digest("hex")}`, bytesRead: 0, truncated: false };
  }

  const reader = response.body.getReader();
  let bytesRead = 0;
  let truncated = false;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      if (!value?.byteLength) continue;
      const remaining = maxBytes - bytesRead;
      if (remaining === 0) {
        truncated = true;
        break;
      }
      const accepted = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      hash.update(accepted);
      bytesRead += accepted.byteLength;
      if (accepted.byteLength < value.byteLength) {
        truncated = true;
        break;
      }
    }
  } finally {
    if (!completed) {
      await reader.cancel("AdsGalaxy webhook response exceeded 64 KiB").catch(() => undefined);
    }
    reader.releaseLock();
  }
  return { hash: `sha256:${hash.digest("hex")}`, bytesRead, truncated };
}

function safeWebhookDeliveryError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const httpStatus = /^HTTP (\d{3})$/.exec(message);
  if (httpStatus) return `HTTP ${httpStatus[1]}`;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "Webhook request timed out";
  }
  return "Webhook request failed";
}

export async function processPendingWebhookDeliveries() {
  const settings = await getSettings();
  const maxAttempts = settingNumber(settings, "webhook_retry_max_attempts", 5);
  const retryDelay = settingNumber(settings, "webhook_retry_delay_minutes", 10);
  const { token, deliveries } = await claimWebhookDeliveryBatch();

  let delivered = 0;
  let failed = 0;
  for (const delivery of deliveries) {
    const payload = delivery.payload && typeof delivery.payload === "object"
      ? delivery.payload
      : delivery.payload
        ? JSON.parse(String(delivery.payload))
        : {};
    const isV2 = delivery.webhook_version === "v2";
    const body = isV2
      ? JSON.stringify(payload)
      : JSON.stringify({ event: delivery.event_type, created_at: delivery.created_at, data: payload });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signingInput = isV2 ? `${timestamp}.${delivery.event_id}.${body}` : body;
    const signature = crypto.createHmac("sha256", deliverySecret(delivery)).update(signingInput).digest("hex");
    try {
      const response = await fetch(String(delivery.url), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-adsgalaxy-event": String(delivery.event_type),
          ...(isV2 ? {
            "x-adsgalaxy-event-id": String(delivery.event_id),
            "x-adsgalaxy-timestamp": timestamp,
            "x-adsgalaxy-signature-version": "v2",
          } : {}),
          "x-adsgalaxy-signature": signature,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      const responseBody = await hashBoundedWebhookResponse(response);
      const responseHash = `${responseBody.hash};bytes=${responseBody.bytesRead};truncated=${responseBody.truncated ? 1 : 0}`;
      if (response.ok) {
        await pool.query(
          `UPDATE developer_webhook_deliveries
           SET status = 'delivered', attempts = attempts + 1, response_status = ?,
               response_body = ?, delivered_at = NOW(), last_attempt_at = NOW(),
               claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL
           WHERE id = ? AND claim_token = ?`,
          [response.status, responseHash, delivery.id, token]
        );
        delivered += 1;
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error: any) {
      const attempts = toInt(delivery.attempts) + 1;
      const v2Terminal = isV2 && attempts >= 6;
      const legacyTerminal = !isV2 && attempts >= maxAttempts;
      const terminal = v2Terminal || legacyTerminal;
      const delay = isV2
        ? V2_RETRY_DELAYS_MINUTES[Math.min(attempts - 1, V2_RETRY_DELAYS_MINUTES.length - 1)]
        : retryDelay;
      await pool.query(
        `UPDATE developer_webhook_deliveries
         SET status = ?, attempts = ?, next_attempt_at = ?,
             error_message = ?, last_attempt_at = NOW(), terminal_at = ?,
             claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL
         WHERE id = ? AND claim_token = ?`,
        [
          terminal ? "failed" : "retrying",
          attempts,
          terminal ? null : new Date(Date.now() + delay * 60_000),
          safeWebhookDeliveryError(error),
          terminal ? new Date() : null,
          delivery.id,
          token,
        ]
      );
      failed += 1;
    }
  }

  return { processed: deliveries.length, delivered, failed };
}

async function auditDeveloperWebhookAction(input: {
  userId: number;
  applicationId: number;
  webhookId?: number;
  deliveryId?: number;
  action: string;
  metadata?: Record<string, unknown>;
  db?: Db;
}) {
  const db = input.db || pool;
  await db.query(
    `INSERT INTO developer_webhook_action_audits
      (user_id, application_id, webhook_id, delivery_id, action, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.userId,
      input.applicationId,
      input.webhookId || null,
      input.deliveryId || null,
      input.action,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ]
  );
}

export async function rotateDeveloperWebhookSecret(
  userId: number,
  webhookId: number,
  callerConnection?: PoolConnection
) {
  const conn = callerConnection || await pool.getConnection();
  const ownsTransaction = !callerConnection;
  const secret = randomToken("whsec");
  try {
    if (ownsTransaction) await conn.beginTransaction();
    const [[webhook]]: any = await conn.query(
      `SELECT application_id, secret_version
       FROM developer_webhooks
       WHERE id = ? AND user_id = ? AND status = 'active'
       FOR UPDATE`,
      [webhookId, userId]
    );
    if (!webhook) throw new Error("Webhook not found");
    const nextVersion = Number(webhook.secret_version || 1) + 1;
    await conn.query(
      `UPDATE developer_webhooks
       SET previous_secret = secret,
           previous_secret_version = secret_version,
           previous_secret_expires_at = DATE_ADD(NOW(), INTERVAL 24 HOUR),
           secret = ?,
           secret_version = ?,
           secret_rotated_at = NOW()
       WHERE id = ? AND user_id = ?`,
      [secret, nextVersion, webhookId, userId]
    );
    await auditDeveloperWebhookAction({
      userId,
      applicationId: Number(webhook.application_id),
      webhookId,
      action: "webhook_secret_rotated",
      metadata: { secret_version: nextVersion, overlap_hours: 24 },
      db: conn,
    });
    if (ownsTransaction) await conn.commit();
    return { secret, secret_version: nextVersion, previous_secret_overlap_hours: 24 };
  } catch (error) {
    if (ownsTransaction) await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    if (ownsTransaction) conn.release();
  }
}

export async function manuallyRetryDeveloperWebhook(
  userId: number,
  deliveryId: number,
  callerConnection?: PoolConnection
) {
  const conn = callerConnection || await pool.getConnection();
  const ownsTransaction = !callerConnection;
  try {
    if (ownsTransaction) await conn.beginTransaction();
    const [[delivery]]: any = await conn.query(
      `SELECT d.*, w.secret AS current_secret, w.secret_version AS current_secret_version
       FROM developer_webhook_deliveries d
       JOIN developer_applications a ON a.id = d.application_id
       JOIN developer_webhooks w ON w.id = d.webhook_id
       WHERE d.id = ? AND a.user_id = ? AND d.status = 'failed' AND d.terminal_at IS NOT NULL
         AND (d.claim_expires_at IS NULL OR d.claim_expires_at <= NOW())
       FOR UPDATE`,
      [deliveryId, userId]
    );
    if (!delivery) throw new Error("Terminal webhook delivery not found");
    const [[activeRetry]]: any = await conn.query(
      `SELECT id
       FROM developer_webhook_deliveries
       WHERE manually_retried_from_id = ?
         AND status IN ('pending', 'retrying')
       LIMIT 1
       FOR UPDATE`,
      [deliveryId]
    );
    if (activeRetry) throw new Error("Manual retry already queued");
    const [[sequence]]: any = await conn.query(
      `SELECT COALESCE(MAX(manual_retry_sequence), 0) + 1 AS next_sequence
       FROM developer_webhook_deliveries
       WHERE id = ? OR manually_retried_from_id = ?`,
      [deliveryId, deliveryId]
    );
    const nextSequence = Number(sequence.next_sequence);
    const logicalKey = `manual:${deliveryId}:${nextSequence}`;
    const [result]: any = await conn.query(
      `INSERT INTO developer_webhook_deliveries
        (webhook_id, application_id, event_type, event_id, webhook_version,
         signature_version, secret_version, signing_secret, logical_delivery_key, manual_retry_sequence,
         manually_retried_from_id, payload, status, next_attempt_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [
        delivery.webhook_id,
        delivery.application_id,
        delivery.event_type,
        delivery.event_id,
        delivery.webhook_version,
        delivery.signature_version,
        Number(delivery.current_secret_version || 1),
        String(delivery.current_secret),
        logicalKey,
        nextSequence,
        deliveryId,
        typeof delivery.payload === "string"
          ? delivery.payload
          : JSON.stringify(delivery.payload || {}),
      ]
    );
    await auditDeveloperWebhookAction({
      userId,
      applicationId: Number(delivery.application_id),
      webhookId: Number(delivery.webhook_id),
      deliveryId: Number(result.insertId),
      action: "webhook_manual_retry",
      metadata: { source_delivery_id: deliveryId, sequence: nextSequence },
      db: conn,
    });
    if (ownsTransaction) await conn.commit();
    return { delivery_id: Number(result.insertId), manual_retry_sequence: nextSequence };
  } catch (error) {
    if (ownsTransaction) await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    if (ownsTransaction) conn.release();
  }
}

export function sandboxAdPayload(applicationId: number, adFormat = "rewarded") {
  const requestId = `sandbox_${applicationId}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  return {
    request_id: requestId,
    ad_format: adFormat,
    sandbox: true,
    creative: {
      title: "AdsGalaxy Sandbox Ad",
      description: "This test ad validates SDK integration without affecting production.",
      image_url: "/logo.svg",
      click_url: `https://adsgalaxy.local/sandbox-click/${requestId}`,
      reward_amount: 0,
    },
  };
}
