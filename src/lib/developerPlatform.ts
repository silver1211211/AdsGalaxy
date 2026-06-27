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
  return clean(request.headers.get("origin") || request.headers.get("referer"));
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
      clean(input.webhookUrl) || null,
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
  const requests = Number(analytics[0]?.requests || 0);
  const successes = Number(analytics[0]?.successes || 0);
  const errors = Number(analytics[0]?.errors || 0);
  return {
    apps: apps.map((app: any) => withIntegrationIds({ ...app, permissions: parseJsonArray(app.permissions) })),
    keys: keys.map((key: any) => ({ ...key, permissions: parseJsonArray(key.permissions) })),
    webhooks: webhooks.map((webhook: any) => ({ ...webhook, events: parseJsonArray(webhook.events) })),
    deliveries,
    analytics: {
      ...(analytics[0] || {}),
      impressions: successes,
      completions: Number(analytics[0]?.reward_validations || 0),
      fill_rate: requests ? (successes / requests) * 100 : 100,
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

export async function validateDeveloperApiRequest(request: Request, requiredPermission: DeveloperPermission, endpoint: string) {
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
  if (allowedOrigins.length > 0 && origin && !allowedOrigins.some((allowed) => origin.startsWith(allowed))) {
    throw Object.assign(new Error("Origin is not allowed for this key"), { statusCode: 403 });
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

export async function saveDeveloperWebhook(userId: number, input: { applicationId: number; url?: unknown; events?: unknown }) {
  const [apps]: any = await pool.query("SELECT id FROM developer_applications WHERE id = ? AND user_id = ?", [input.applicationId, userId]);
  if (apps.length === 0) throw new Error("Application not found");
  const secret = randomToken("whsec");
  await pool.query(
    "INSERT INTO developer_webhooks (application_id, user_id, url, secret, events) VALUES (?, ?, ?, ?, ?)",
    [input.applicationId, userId, clean(input.url), secret, JSON.stringify(parseJsonArray(input.events, ["*"]))]
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

export async function processPendingWebhookDeliveries() {
  const settings = await getSettings();
  const maxAttempts = settingNumber(settings, "webhook_retry_max_attempts", 5);
  const retryDelay = settingNumber(settings, "webhook_retry_delay_minutes", 10);
  const [deliveries]: any = await pool.query(
    `SELECT d.*, w.url, w.secret
     FROM developer_webhook_deliveries d
     JOIN developer_webhooks w ON w.id = d.webhook_id
     WHERE d.status IN ('pending', 'retrying')
       AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= NOW())
     ORDER BY d.created_at ASC
     LIMIT 25`
  );

  let delivered = 0;
  let failed = 0;
  for (const delivery of deliveries) {
    const payload = delivery.payload ? JSON.parse(String(delivery.payload)) : {};
    const body = JSON.stringify({ event: delivery.event_type, created_at: delivery.created_at, data: payload });
    const signature = crypto.createHmac("sha256", String(delivery.secret)).update(body).digest("hex");
    try {
      const response = await fetch(String(delivery.url), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-adsgalaxy-event": String(delivery.event_type),
          "x-adsgalaxy-signature": signature,
        },
        body,
      });
      if (response.ok) {
        await pool.query("UPDATE developer_webhook_deliveries SET status = 'delivered', attempts = attempts + 1, response_status = ?, delivered_at = NOW() WHERE id = ?", [response.status, delivery.id]);
        delivered += 1;
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error: any) {
      const attempts = toInt(delivery.attempts) + 1;
      const status = attempts >= maxAttempts ? "failed" : "retrying";
      await pool.query(
        "UPDATE developer_webhook_deliveries SET status = ?, attempts = ?, next_attempt_at = DATE_ADD(NOW(), INTERVAL ? MINUTE), error_message = ? WHERE id = ?",
        [status, attempts, retryDelay, String(error?.message || "Webhook failed").slice(0, 255), delivery.id]
      );
      failed += 1;
    }
  }

  return { processed: deliveries.length, delivered, failed };
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
