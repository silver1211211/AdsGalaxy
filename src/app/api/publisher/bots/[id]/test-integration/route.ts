import crypto from "crypto";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import {
  assertBotIntegrationSecretReadable,
  ensureBotIntegration,
  isBotEncryptionError,
  loadBotToken,
  publisherBotEncryptionErrorMessage,
  validateBotIntegrationEncryptionConfig,
} from "@/lib/botIntegration";
import { getBotAudienceStats } from "@/lib/botAudience";

export const dynamic = "force-dynamic";

type CheckStatus = "success" | "warning" | "failure";
type Check = { key: string; label: string; status: CheckStatus; message: string; diagnostic?: string };
type BotRow = RowDataPacket & {
  id: number;
  user_id: number;
  bot_name: string | null;
  bot_username: string | null;
  status: string;
  bot_token: string | null;
  bot_token_encrypted: string | null;
  integration_secret_encrypted: string | null;
  integration_secret_hash: string | null;
  integration_installed_at: string | null;
  integration_last_received_at: string | null;
  integration_last_error_at: string | null;
  integration_last_error: string | null;
};

function check(key: string, label: string, status: CheckStatus, message: string, diagnostic?: string): Check {
  return { key, label, status, message, ...(diagnostic ? { diagnostic } : {}) };
}

function summarize(checks: Check[]) {
  if (checks.some((item) => item.status === "failure")) return "failure";
  if (checks.some((item) => item.status === "warning")) return "warning";
  return "success";
}

function appOrigin(request: Request) {
  return new URL(request.url).origin;
}

async function telegramJson(token: string, method: string) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const checks: Check[] = [];
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const { id } = await params;
    checks.push(check("publisher_authorization", "Publisher authorization valid", "success", "Publisher owns this bot and is authorized to run diagnostics."));

    const [bots] = await pool.query<BotRow[]>(
      `SELECT id, user_id, bot_name, bot_username, status, bot_token, bot_token_encrypted,
        integration_secret_encrypted, integration_secret_hash, integration_installed_at,
        integration_last_received_at, integration_last_error_at, integration_last_error
       FROM bots
       WHERE id = ? AND user_id = ? AND is_deleted = FALSE
       LIMIT 1`,
      [id, user.id]
    );
    const bot = bots[0];
    if (!bot) return NextResponse.json({ error: "Bot not found" }, { status: 404 });

    if (["paused", "deleted", "token_invalid", "bot_deleted", "unreachable"].includes(String(bot.status || ""))) {
      checks.push(check("bot_enabled", "Bot enabled", "failure", "Bot Disabled"));
    } else if (bot.status === "rejected") {
      checks.push(check("bot_approved", "Publisher approved", "failure", "Publisher Not Approved"));
    } else if (bot.status !== "active") {
      checks.push(check("bot_approved", "Publisher approved", "failure", "Publisher Not Approved"));
    } else {
      checks.push(check("bot_approved", "Publisher approved", "success", "Bot is approved and active."));
    }

    try {
      validateBotIntegrationEncryptionConfig();
      checks.push(check("encryption_config", "Developer secret valid", "success", "Encrypted integration credentials are configured and readable."));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Encryption configuration failed";
      checks.push(check("encryption_config", "Developer secret valid", "failure", "Secret Invalid", message));
      return NextResponse.json({ success: false, status: "failure", checks, error: publisherBotEncryptionErrorMessage() }, { status: 503 });
    }

    let token = "";
    try {
      token = await loadBotToken(pool, bot);
      checks.push(check("bot_token_storage", "Bot Verified", "success", "Bot token is present and decrypts successfully."));
    } catch (error: unknown) {
      if (isBotEncryptionError(error)) {
        checks.push(check("bot_token_storage", "Bot Verified", "failure", "Invalid Bot Token", error.code));
        return NextResponse.json({ success: false, status: "failure", checks, error: publisherBotEncryptionErrorMessage() }, { status: 503 });
      }
      throw error;
    }

    const integrationUrl = await ensureBotIntegration(pool, appOrigin(request), bot.id);
    try {
      assertBotIntegrationSecretReadable(bot.integration_secret_encrypted, bot.integration_secret_hash);
      checks.push(check("integration_secret", "AdsGalaxy Connected", "success", "Integration secret is readable and matches its stored hash."));
    } catch (error: unknown) {
      checks.push(check("integration_secret", "AdsGalaxy Connected", "failure", "Secret Invalid", isBotEncryptionError(error) ? error.code : undefined));
    }

    try {
      const { response, data } = await telegramJson(token, "getMe");
      if (data.ok) {
        const usernameMatches = !bot.bot_username || String(data.result?.username || "").toLowerCase() === String(bot.bot_username || "").toLowerCase();
        checks.push(check("telegram_getme", "Telegram Reachable", usernameMatches ? "success" : "warning", usernameMatches ? `Telegram recognizes @${data.result?.username}.` : "Telegram token works, but username differs from the stored bot username."));
      } else {
        checks.push(check("telegram_getme", "Telegram Reachable", "failure", data.description || `Invalid Bot Token: Telegram returned HTTP ${response.status}`));
      }
    } catch (error: unknown) {
      checks.push(check("telegram_getme", "Telegram Reachable", "failure", "Telegram getMe request failed.", error instanceof Error ? error.message : undefined));
    }

    try {
      const { data } = await telegramJson(token, "getWebhookInfo");
      if (data.ok) {
        checks.push(check("telegram_webhook", "Webhook configuration valid", "success", data.result?.url ? "Telegram webhook is configured on the publisher bot." : "No Telegram webhook is configured; polling or custom delivery may be used."));
      } else {
        checks.push(check("telegram_webhook", "Webhook configuration valid", "warning", data.description || "Webhook status could not be read."));
      }
    } catch (error: unknown) {
      checks.push(check("telegram_webhook", "Webhook configuration valid", "warning", "Webhook Error", error instanceof Error ? error.message : undefined));
    }

    try {
      const sdkResponse = await fetch(`${appOrigin(request)}/sdk/javascript/adsgalaxy.js`, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(5000) });
      checks.push(check("sdk_connected", "SDK Connected", sdkResponse.ok ? "success" : "failure", sdkResponse.ok ? "AdsGalaxy SDK is reachable." : "SDK Missing"));
    } catch (error: unknown) {
      checks.push(check("sdk_connected", "SDK Connected", "failure", "SDK Missing", error instanceof Error ? error.message : undefined));
    }

    const requestId = `diag-${bot.id}-${Date.now()}-${crypto.randomUUID()}`;
    const callbackResponse = await fetch(integrationUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        test: true,
        bot_id: String(bot.id),
        telegram_user_id: `9${String(bot.id).padStart(7, "0").slice(0, 7)}`,
        username: "adsgalaxy_test",
        timestamp: Math.floor(Date.now() / 1000),
        request_id: requestId,
      }),
      cache: "no-store",
    });
    const callbackData = await callbackResponse.json().catch(() => ({}));
    checks.push(check(
      "sdk_callback",
      "Integration endpoint reachable",
      callbackResponse.ok && callbackData.success ? "success" : "failure",
      callbackData.message || (callbackResponse.ok ? "Callback replied." : `Callback failed with HTTP ${callbackResponse.status}`)
    ));

    const [eventRows] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM bot_integration_events WHERE bot_id = ? AND request_id_hash = ? LIMIT 1",
      [bot.id, crypto.createHash("sha256").update(requestId).digest("hex")]
    );
    checks.push(check("database_registration", "AdsGalaxy Connected", eventRows[0] ? "success" : "failure", eventRows[0] ? "Diagnostic integration event was stored." : "Diagnostic integration event was not stored."));

    const stats = await getBotAudienceStats(bot.id);
    checks.push(check("connection_state", "Bot Verified", bot.status === "active" ? "success" : "failure", bot.status === "active" ? "Bot Verified" : `Bot lifecycle status is ${bot.status}.`));
    checks.push(check("reachability_counts", "Reachability counts", "success", `${stats.verified_users} verified/reachable, ${stats.pending_verification} pending verification, ${stats.blocked_users} blocked.`));

    const [developerRows] = await pool.query<RowDataPacket[]>(
      `SELECT a.id
       FROM developer_applications a
       JOIN developer_api_keys k ON k.application_id = a.id
       WHERE a.user_id = ? AND a.status = 'active' AND k.status = 'active'
       LIMIT 1`,
      [user.id]
    );
    checks.push(check("sdk_authentication", "Developer secret valid", developerRows[0] ? "success" : "failure", developerRows[0] ? "Active developer application and API key exist." : "Unauthorized"));

    const status = summarize(checks);
    checks.push(check("ready_for_production", "Ready for Production", status === "success" ? "success" : "failure", status === "success" ? "Ready for Production" : "Integration is not ready for production."));
    return NextResponse.json({
      success: status !== "failure",
      status,
      message: status === "success" ? "Integration verified successfully." : status === "warning" ? "Integration verified with warnings." : "Integration verification failed.",
      bot: { id: bot.id, username: bot.bot_username, lifecycle_status: bot.status },
      stats,
      checks,
    });
  } catch (error: unknown) {
    if (isBotEncryptionError(error)) {
      checks.push(check("credential_failure", "Credential verification", "failure", "Bot credential verification failed.", error.code));
      return NextResponse.json({ success: false, status: "failure", checks, error: publisherBotEncryptionErrorMessage() }, { status: 503 });
    }
    console.error("Bot integration diagnostic failed", { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Integration diagnostic failed", checks }, { status: getAuthErrorStatus(error) });
  }
}
