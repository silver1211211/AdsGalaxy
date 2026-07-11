import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { assertBotIntegrationSecretReadable, isBotEncryptionError, verifyBotIntegrationSecret } from "@/lib/botIntegration";

type BotRow = RowDataPacket & { id: number; status: string; integration_secret_hash: string | null; integration_secret_encrypted: string | null };
type ExistingUserRow = RowDataPacket & { id: number; integration_first_seen_at: string | null };
type RateRow = RowDataPacket & { event_count: number };
type Payload = Record<string, unknown>;

const RATE_LIMIT_PER_MINUTE = 120;
const MAX_CLOCK_SKEW_SECONDS = 300;

function clean(value: unknown, max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function numericId(value: unknown) {
  const id = clean(value);
  return /^-?\d+$/.test(id) ? id : null;
}

function requestFingerprint(request: Request) {
  const ip = clean(request.headers.get("x-forwarded-for")?.split(",")[0] || request.headers.get("x-real-ip") || "unknown");
  return crypto.createHash("sha256").update(ip).digest("hex");
}

async function logEvent(botId: number, type: "user" | "duplicate" | "test" | "error" | "rate_limited", message: string, request: Request, userId?: string | null, username?: string | null) {
  await pool.query(
    `INSERT INTO bot_integration_events (bot_id, event_type, telegram_user_id, username, message, source_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [botId, type, userId || null, username || null, clean(message, 500), requestFingerprint(request)]
  );
}

async function recordError(botId: number, message: string, request: Request, status: number) {
  await Promise.all([
    pool.query(
      "UPDATE bots SET integration_last_error_at = NOW(), integration_last_error = ? WHERE id = ?",
      [clean(message, 500), botId]
    ),
    logEvent(botId, status === 429 ? "rate_limited" : "error", message, request),
  ]);
  return NextResponse.json({ success: false, message }, { status });
}

async function readPayload(request: Request, method: "GET" | "POST"): Promise<Payload> {
  if (method === "GET") return Object.fromEntries(new URL(request.url).searchParams.entries());
  return await request.json().catch(() => ({})) as Payload;
}

function requestIdHash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function validRequestMetadata(body: Payload) {
  const requestId = clean(body.request_id, 128);
  const timestamp = Number(body.timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (requestId.length < 16 || !/^[A-Za-z0-9._:-]+$/.test(requestId)) return { error: "A valid request_id is required" } as const;
  if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS) return { error: "Timestamp is invalid or expired" } as const;
  return { requestId, hash: requestIdHash(requestId) } as const;
}

async function handleIntegration(request: Request, params: Promise<{ botId: string; secret: string }>, method: "GET" | "POST") {
  const { botId, secret } = await params;
  if (!/^\d+$/.test(botId) || !secret) return NextResponse.json({ success: false, message: "Integration not found" }, { status: 404 });

  const [bots] = await pool.query<BotRow[]>(
    "SELECT id, status, integration_secret_hash, integration_secret_encrypted FROM bots WHERE id = ? AND is_deleted = FALSE LIMIT 1",
    [botId]
  );
  const bot = bots[0];
  if (!bot) {
    return NextResponse.json({ success: false, message: "Integration not found" }, { status: 404 });
  }
  try {
    assertBotIntegrationSecretReadable(bot.integration_secret_encrypted, bot.integration_secret_hash);
  } catch (error: unknown) {
    if (isBotEncryptionError(error)) {
      console.error("Bot integration encryption/configuration failure", { bot_id: bot.id, code: error.code });
      return NextResponse.json({ success: false, message: "Integration is temporarily unavailable" }, { status: 503 });
    }
    throw error;
  }
  if (!verifyBotIntegrationSecret(bot.integration_secret_hash, secret)) {
    return NextResponse.json({ success: false, message: "Integration not found" }, { status: 404 });
  }
  if (["paused", "rejected", "deleted", "token_invalid", "bot_deleted", "unreachable"].includes(String(bot.status))) {
    return NextResponse.json({ success: false, message: "Integration is disabled" }, { status: 403 });
  }

  const [rateRows] = await pool.query<RateRow[]>(
    `SELECT COUNT(*) AS event_count FROM bot_integration_events
     WHERE bot_id = ? AND source_hash = ? AND received_at >= DATE_SUB(NOW(), INTERVAL 1 MINUTE)`,
    [bot.id, requestFingerprint(request)]
  );
  if (Number(rateRows[0]?.event_count || 0) >= RATE_LIMIT_PER_MINUTE) {
    return NextResponse.json({ success: false, message: "Rate limit exceeded" }, { status: 429 });
  }

  const body = await readPayload(request, method);
  const metadata = validRequestMetadata(body);
  if ("error" in metadata) return recordError(bot.id, metadata.error!, request, 400);
  const suppliedBotId = clean(body.bot_id);
  if (!suppliedBotId || suppliedBotId !== String(bot.id)) {
    return recordError(bot.id, "Bot identifier does not match this Integration URL", request, 403);
  }
  const [replays] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM bot_integration_events WHERE bot_id = ? AND request_id_hash = ? LIMIT 1",
    [bot.id, metadata.hash]
  );
  if (replays[0]) return recordError(bot.id, "Request has already been processed", request, 409);
  if (body.test === true || clean(body.test) === "1" || clean(body.test).toLowerCase() === "true") {
    await Promise.all([
      pool.query("UPDATE bots SET integration_installed_at = COALESCE(integration_installed_at, NOW()), integration_last_error_at = NULL, integration_last_error = NULL WHERE id = ?", [bot.id]),
      pool.query(
        `INSERT INTO bot_integration_events (bot_id, event_type, telegram_user_id, username, message, source_hash, request_id_hash)
         VALUES (?, 'test', ?, ?, 'Integration test successful', ?, ?)`,
        [bot.id, numericId(body.telegram_user_id), clean(body.username) || null, requestFingerprint(request), metadata.hash]
      ),
    ]);
    return NextResponse.json({ success: true, message: "Integration test successful", test: true });
  }

  const telegramUserId = numericId(body.telegram_user_id);
  const chatId = numericId(body.chat_id);
  const effectiveUserId = telegramUserId || chatId;
  const effectiveChatId = chatId || telegramUserId;
  if (!effectiveUserId || !effectiveChatId) {
    return recordError(bot.id, "telegram_user_id or chat_id is required", request, 400);
  }

  const username = clean(body.username) || null;
  const firstName = clean(body.first_name) || null;
  const languageCode = clean(body.language_code, 16) || null;
  const connection = await pool.getConnection();
  let duplicate = false;
  try {
    await connection.beginTransaction();
    await connection.query("SELECT id FROM bots WHERE id = ? FOR UPDATE", [bot.id]);
    const [existingRows] = await connection.query<ExistingUserRow[]>(
      `SELECT id, integration_first_seen_at FROM bot_users
       WHERE bot_id = ? AND chat_id = ?
       ORDER BY id ASC LIMIT 1 FOR UPDATE`,
      [bot.id, effectiveChatId]
    );
    const existing = existingRows[0];
    duplicate = Boolean(existing);
    if (existing) {
      await connection.query(
        `UPDATE bot_users SET chat_id = ?, telegram_username = ?, telegram_first_name = ?,
           telegram_language_code = ?, last_seen_at = NOW(), duplicate_start_count = duplicate_start_count + 1,
           integration_first_seen_at = COALESCE(integration_first_seen_at, NOW()),
           source = 'integration', is_active = TRUE, status = 'active', inactive_reason = NULL,
           verification_success_at = COALESCE(verification_success_at, NOW()), verification_last_error = NULL,
           verification_next_attempt_at = NULL, verification_claim_token = NULL, verification_claim_expires_at = NULL
         WHERE id = ?`,
        [effectiveChatId, username, firstName, languageCode, existing.id]
      );
    } else {
      await connection.query(
        `INSERT INTO bot_users
           (bot_id, chat_id, telegram_username, telegram_first_name, telegram_language_code,
            registered_at, first_seen_at, last_seen_at, duplicate_start_count, integration_first_seen_at,
            source, is_active, status, verification_success_at)
         VALUES (?, ?, ?, ?, ?, NOW(), NOW(), NOW(), 0, NOW(), 'integration', TRUE, 'active', NOW())`,
        [bot.id, effectiveChatId, username, firstName, languageCode]
      );
    }
    await connection.query(
      `UPDATE bots SET integration_installed_at = COALESCE(integration_installed_at, NOW()), integration_last_received_at = NOW(), integration_last_user_id = ?,
         integration_last_error_at = NULL, integration_last_error = NULL WHERE id = ?`,
      [effectiveUserId, bot.id]
    );
    await connection.query(
      `INSERT INTO bot_integration_events (bot_id, event_type, telegram_user_id, username, message, source_hash, request_id_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [bot.id, duplicate ? "duplicate" : "user", effectiveUserId, username, duplicate ? "User already recorded" : "User recorded", requestFingerprint(request), metadata.hash]
    );
    await connection.commit();
  } catch (error: unknown) {
    await connection.rollback();
    if (error && typeof error === "object" && "code" in error && error.code === "ER_DUP_ENTRY") {
      return recordError(bot.id, "Request has already been processed", request, 409);
    }
    console.error("Bot integration storage failed", { bot_id: bot.id, error: error instanceof Error ? error.message : "unknown" });
    return recordError(bot.id, "Unable to record user", request, 500);
  } finally {
    connection.release();
  }

  return NextResponse.json(duplicate
    ? { success: true, message: "User already recorded", updated: true }
    : { success: true, message: "User recorded" });
}

export async function POST(request: Request, { params }: { params: Promise<{ botId: string; secret: string }> }) {
  return handleIntegration(request, params, "POST");
}

export async function GET(request: Request, { params }: { params: Promise<{ botId: string; secret: string }> }) {
  void request; void params;
  return NextResponse.json({ success: false, message: "Use POST with a JSON body" }, { status: 405, headers: { Allow: "POST" } });
}
