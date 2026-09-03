import { NextResponse } from "next/server";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import {
  assertSafeDirectCallbackUrl,
  directMiniappRewardCallbacksEnabled,
  generateDirectCallbackSecret,
} from "@/lib/miniappDirectRewardCallbacks";

function callbackStatus(configuredStatus: string) {
  const platformEnabled = directMiniappRewardCallbacksEnabled();
  const effectiveStatus = configuredStatus === "active"
    ? platformEnabled ? "active" : "saved_platform_disabled"
    : "disabled_by_publisher";
  return {
    configured_status: configuredStatus,
    platform_enabled: platformEnabled,
    effective_status: effectiveStatus,
  };
}

type PublicCallbackError = Error & { statusCode?: number; publicCode?: string };

function publicCallbackError(publicCode: string, message: string, statusCode: number) {
  return Object.assign(new Error(message), { publicCode, statusCode });
}

async function ensureCallbackSchemaReady() {
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT
      EXISTS(
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'miniapp_reward_callbacks'
      )
      AND 3 = (
        SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'developer_webhook_deliveries'
          AND COLUMN_NAME IN ('miniapp_reward_callback_id', 'miniapp_id', 'logical_delivery_key')
      ) AS schema_ready
  `);
  if (!Number(rows[0]?.schema_ready)) {
    throw publicCallbackError(
      "CALLBACK_SCHEMA_NOT_READY",
      "Reward callbacks are temporarily unavailable while setup is completed.",
      503,
    );
  }
}

async function ownedMiniapp(request: Request, id: string) {
  const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
  const miniappId = Number(id);
  if (!Number.isInteger(miniappId) || miniappId <= 0) throw Object.assign(new Error("Mini App not found"), { statusCode: 404 });
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM miniapps WHERE id = ? AND user_id = ? AND is_deleted = FALSE LIMIT 1",
    [miniappId, user.id]
  );
  if (!rows[0]) throw Object.assign(new Error("Mini App not found"), { statusCode: 404 });
  return { miniappId, userId: Number(user.id) };
}

function failure(error: unknown) {
  const err = error as PublicCallbackError;
  const authFailure = /^(Unauthorized|Invalid initData)/.test(err.message || "");
  const validationFailure = /Callback URL|Unsupported action/.test(err.message || "");
  if (err.publicCode) {
    return NextResponse.json({ error: { code: err.publicCode, message: err.message } }, { status: err.statusCode || 500 });
  }
  if (authFailure || validationFailure || err.statusCode === 404) {
    return NextResponse.json({
      error: {
        code: authFailure ? "UNAUTHORIZED" : validationFailure ? "INVALID_CALLBACK_REQUEST" : "MINIAPP_NOT_FOUND",
        message: err.message,
      },
    }, { status: err.statusCode || (authFailure ? 401 : validationFailure ? 400 : 404) });
  }
  console.error("Reward callback request failed", { code: (error as { code?: unknown })?.code || "UNKNOWN" });
  return NextResponse.json({
    error: { code: "CALLBACK_REQUEST_FAILED", message: "Reward callback request failed. Please try again." },
  }, { status: getAuthErrorStatus(error) });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { miniappId } = await ownedMiniapp(request, id);
    await ensureCallbackSchemaReady();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.callback_url, c.status, c.secret_version, c.rotated_at,
              COUNT(d.id) deliveries,
              SUM(d.status = 'delivered') delivered,
              SUM(d.status IN ('pending','retrying')) pending,
              SUM(d.status = 'failed') failed
       FROM miniapp_reward_callbacks c
       LEFT JOIN developer_webhook_deliveries d ON d.miniapp_reward_callback_id = c.id
       WHERE c.miniapp_id = ? GROUP BY c.id`, [miniappId]
    );
    const row = rows[0];
    return NextResponse.json(row ? {
      configured: true, callback_url: row.callback_url, status: row.status,
      ...callbackStatus(String(row.status)),
      has_secret: true, secret_version: Number(row.secret_version), rotated_at: row.rotated_at,
      delivery_summary: { total: Number(row.deliveries), delivered: Number(row.delivered), pending: Number(row.pending), failed: Number(row.failed) },
    } : {
      configured: false, status: "disabled", ...callbackStatus("disabled"),
      has_secret: false, delivery_summary: { total: 0, delivered: 0, pending: 0, failed: 0 },
    });
  } catch (error) { return failure(error); }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { miniappId } = await ownedMiniapp(request, id);
    await ensureCallbackSchemaReady();
    const body = await request.json();
    const callbackUrl = await assertSafeDirectCallbackUrl(body?.callback_url);
    const secret = generateDirectCallbackSecret();
    const [existing] = await pool.query<RowDataPacket[]>("SELECT id FROM miniapp_reward_callbacks WHERE miniapp_id = ?", [miniappId]);
    if (existing[0]) {
      await pool.query("UPDATE miniapp_reward_callbacks SET callback_url = ?, status = 'active' WHERE miniapp_id = ?", [callbackUrl, miniappId]);
      return NextResponse.json({
        configured: true, callback_url: callbackUrl, status: "active",
        ...callbackStatus("active"), secret_returned: false,
      });
    }
    await pool.query(
      "INSERT INTO miniapp_reward_callbacks (miniapp_id, callback_url, status, signing_secret) VALUES (?, ?, 'active', ?)",
      [miniappId, callbackUrl, secret]
    );
    return NextResponse.json({
      configured: true, callback_url: callbackUrl, status: "active",
      ...callbackStatus("active"), signing_secret: secret, secret_version: 1, secret_returned: true,
    });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let conn: PoolConnection | null = null;
  try {
    const { id } = await params;
    const { miniappId } = await ownedMiniapp(request, id);
    await ensureCallbackSchemaReady();
    const body = await request.json();
    if (body?.action !== "rotate") throw Object.assign(new Error("Unsupported action"), { statusCode: 400 });
    const secret = generateDirectCallbackSecret();
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT id, secret_version FROM miniapp_reward_callbacks WHERE miniapp_id = ? FOR UPDATE", [miniappId]
    );
    if (!rows[0]) throw Object.assign(new Error("Configure a callback before rotating its secret"), { statusCode: 404 });
    const version = Number(rows[0].secret_version) + 1;
    await conn.query(
      `UPDATE miniapp_reward_callbacks SET previous_signing_secret = signing_secret,
       previous_secret_version = secret_version, previous_secret_expires_at = DATE_ADD(NOW(), INTERVAL 24 HOUR),
       signing_secret = ?, secret_version = ?, rotated_at = NOW() WHERE id = ?`,
      [secret, version, rows[0].id]
    );
    await conn.commit();
    return NextResponse.json({ signing_secret: secret, secret_version: version, previous_secret_overlap_hours: 24, secret_returned: true });
  } catch (error) { await conn?.rollback().catch(() => undefined); return failure(error); }
  finally { conn?.release(); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { miniappId } = await ownedMiniapp(request, id);
    await ensureCallbackSchemaReady();
    await pool.query("UPDATE miniapp_reward_callbacks SET status = 'disabled' WHERE miniapp_id = ?", [miniappId]);
    return NextResponse.json({ configured: true, status: "disabled", ...callbackStatus("disabled") });
  } catch (error) { return failure(error); }
}
