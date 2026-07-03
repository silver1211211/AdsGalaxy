import "server-only";

import crypto from "crypto";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

type IntegrationDb = Pool | PoolConnection;

type StoredIntegrationRow = RowDataPacket & {
  integration_secret_encrypted: string | null;
  integration_secret_hash: string | null;
  webhook_url: string | null;
};

export type BotEncryptionErrorCode =
  | "encryption_config_error"
  | "bot_token_decryption_failed"
  | "bot_token_unavailable"
  | "integration_secret_decryption_failed"
  | "integration_secret_unavailable";

export class BotEncryptionError extends Error {
  readonly code: BotEncryptionErrorCode;

  constructor(code: BotEncryptionErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BotEncryptionError";
    this.code = code;
  }
}

export function isBotEncryptionError(error: unknown): error is BotEncryptionError {
  return error instanceof BotEncryptionError;
}

export function publisherBotEncryptionErrorMessage() {
  return "Bot credentials are temporarily unavailable. Please contact support.";
}

function clean(value: unknown) {
  return String(value || "").trim();
}

function encryptionKey() {
  const secret = clean(process.env.BOT_INTEGRATION_ENCRYPTION_KEY);
  if (!secret) {
    throw new BotEncryptionError("encryption_config_error", "BOT_INTEGRATION_ENCRYPTION_KEY is not configured");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptSecret(secret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

function decryptSecret(value: unknown, code: "bot_token_decryption_failed" | "integration_secret_decryption_failed") {
  const stored = clean(value);
  if (!stored) return null;
  const [version, iv, tag, encrypted, ...extra] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted || extra.length > 0) {
    throw new BotEncryptionError(code, "Stored encrypted credential has an invalid envelope");
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch (error: unknown) {
    if (isBotEncryptionError(error)) throw error;
    throw new BotEncryptionError(code, "Stored credential could not be decrypted", { cause: error });
  }
}

function isSecureOrHashPlaceholder(value: unknown) {
  const candidate = clean(value);
  return /^(?:secure|hash|sha256):/i.test(candidate) || /^[a-f0-9]{64}$/i.test(candidate);
}

export function isLegacyPlaintextBotToken(value: unknown) {
  const candidate = clean(value);
  return !isSecureOrHashPlaceholder(candidate) && /^\d{5,20}:[A-Za-z0-9_-]{20,}$/.test(candidate);
}

export function hashBotIntegrationSecret(secret: string) {
  return crypto.createHash("sha256").update(clean(secret)).digest("hex");
}

export function verifyBotIntegrationSecret(storedHash: unknown, suppliedSecret: unknown) {
  const expected = clean(storedHash);
  const supplied = hashBotIntegrationSecret(clean(suppliedSecret));
  return expected.length === supplied.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

function secretFromLegacyUrl(value: unknown) {
  try {
    return clean(new URL(clean(value)).pathname.split("/").filter(Boolean).at(-1)) || null;
  } catch {
    return null;
  }
}

function appOrigin(requestOrigin: string) {
  return clean(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_ADSGALAXY_APP_URL || requestOrigin).replace(/\/$/, "");
}

export async function ensureBotIntegration(db: IntegrationDb, requestOrigin: string, botId: number | string) {
  const [rows] = await db.query<StoredIntegrationRow[]>(
    "SELECT integration_secret_encrypted, integration_secret_hash, webhook_url FROM bots WHERE id = ? LIMIT 1",
    [botId]
  );
  const bot = rows[0];
  if (!bot) throw new Error("Bot not found");

  let secret = bot.integration_secret_encrypted
    ? assertBotIntegrationSecretReadable(bot.integration_secret_encrypted, bot.integration_secret_hash)
    : null;
  if (!secret) {
    const legacySecret = secretFromLegacyUrl(bot.webhook_url);
    if (legacySecret && isSecureOrHashPlaceholder(legacySecret)) {
      throw new BotEncryptionError("integration_secret_unavailable", "Legacy Integration URL contains a credential placeholder");
    }
    if (bot.integration_secret_hash && (!legacySecret || !verifyBotIntegrationSecret(bot.integration_secret_hash, legacySecret))) {
      throw new BotEncryptionError("integration_secret_unavailable", "Existing Integration secret cannot be recovered safely");
    }
    secret = legacySecret || crypto.randomBytes(32).toString("base64url");
    await db.query(
      `UPDATE bots
       SET integration_secret_encrypted = ?,
           integration_secret_hash = ?
       WHERE id = ?`,
      [encryptSecret(secret), hashBotIntegrationSecret(secret), botId]
    );
  }

  return `${appOrigin(requestOrigin)}/api/bot/integration/${encodeURIComponent(clean(botId))}/${secret}`;
}

export async function regenerateBotIntegration(db: IntegrationDb, requestOrigin: string, botId: number | string) {
  const [rows] = await db.query<StoredIntegrationRow[]>(
    "SELECT integration_secret_encrypted, integration_secret_hash, webhook_url FROM bots WHERE id = ? LIMIT 1",
    [botId]
  );
  const existing = rows[0];
  if (!existing) throw new Error("Bot not found");
  if (existing.integration_secret_encrypted) {
    assertBotIntegrationSecretReadable(existing.integration_secret_encrypted, existing.integration_secret_hash);
  } else if (existing.integration_secret_hash) {
    const legacySecret = secretFromLegacyUrl(existing.webhook_url);
    if (!legacySecret || !verifyBotIntegrationSecret(existing.integration_secret_hash, legacySecret)) {
      throw new BotEncryptionError("integration_secret_unavailable", "Existing Integration secret cannot be recovered safely");
    }
  }
  const secret = crypto.randomBytes(32).toString("base64url");
  await db.query(
    `UPDATE bots SET integration_secret_encrypted = ?, integration_secret_hash = ?, webhook_url = NULL,
       integration_installed_at = NULL, integration_last_received_at = NULL,
       integration_last_user_id = NULL, integration_last_error_at = NULL, integration_last_error = NULL
     WHERE id = ?`,
    [encryptSecret(secret), hashBotIntegrationSecret(secret), botId]
  );
  await db.query(
    `INSERT INTO bot_integration_events (bot_id, event_type, message)
     VALUES (?, 'secret_regenerated', 'Integration secret regenerated')`,
    [botId]
  );
  return `${appOrigin(requestOrigin)}/api/bot/integration/${encodeURIComponent(clean(botId))}/${secret}`;
}

export function botTokenHash(botToken: string) {
  return crypto.createHash("sha256").update(clean(botToken)).digest("hex");
}

export function encryptBotToken(botToken: string) {
  const token = clean(botToken);
  if (!token) throw new Error("Bot token is required");
  return encryptSecret(token);
}

export function decryptBotToken(encrypted: unknown, legacyPlaintext?: unknown) {
  const decrypted = decryptSecret(encrypted, "bot_token_decryption_failed");
  if (decrypted) {
    if (!isLegacyPlaintextBotToken(decrypted)) {
      throw new BotEncryptionError("bot_token_decryption_failed", "Decrypted bot token is not a valid Telegram token");
    }
    return decrypted;
  }
  const legacy = clean(legacyPlaintext);
  if (isLegacyPlaintextBotToken(legacy)) return legacy;
  throw new BotEncryptionError("bot_token_unavailable", isSecureOrHashPlaceholder(legacy)
    ? "Stored bot token is a secure placeholder, not legacy plaintext"
    : "Bot token is unavailable");
}

export async function loadBotToken(db: IntegrationDb, bot: { id: number | string; bot_token_encrypted?: unknown; bot_token?: unknown }) {
  const token = decryptBotToken(bot.bot_token_encrypted, bot.bot_token);
  if (!clean(bot.bot_token_encrypted)) {
    const hash = botTokenHash(token);
    const encryptedToken = encryptBotToken(token);
    await db.query(
      "UPDATE bots SET bot_token_encrypted = ?, bot_token_hash = ?, bot_token = ? WHERE id = ?",
      [encryptedToken, hash, `secure:${hash}`, bot.id]
    );
  }
  return token;
}

export function assertBotIntegrationSecretReadable(encrypted: unknown, storedHash?: unknown) {
  const secret = decryptSecret(encrypted, "integration_secret_decryption_failed");
  if (!secret) {
    throw new BotEncryptionError("integration_secret_unavailable", "Integration secret is unavailable");
  }
  if (clean(storedHash) && !verifyBotIntegrationSecret(storedHash, secret)) {
    throw new BotEncryptionError("integration_secret_decryption_failed", "Integration secret does not match its stored hash");
  }
  return secret;
}

export type BotIntegrationStatus = "not_installed" | "installed" | "imported_pending_verification" | "active" | "error" | "disabled";

export function resolveBotIntegrationStatus(input: {
  botStatus: unknown;
  registrationCount: unknown;
  pendingVerificationCount?: unknown;
  installedAt: unknown;
  lastReceivedAt: unknown;
  lastErrorAt: unknown;
}): BotIntegrationStatus {
  const disabled = ["paused", "rejected", "deleted", "token_invalid", "bot_deleted", "unreachable"].includes(clean(input.botStatus).toLowerCase());
  if (disabled) return "disabled";
  const lastReceived = input.lastReceivedAt ? new Date(String(input.lastReceivedAt)).getTime() : 0;
  const lastError = input.lastErrorAt ? new Date(String(input.lastErrorAt)).getTime() : 0;
  if (lastError && lastError > lastReceived) return "error";
  if (Number(input.registrationCount || 0) > 0 || lastReceived) return "active";
  if (Number(input.pendingVerificationCount || 0) > 0) return "imported_pending_verification";
  if (input.installedAt) return "installed";
  return "not_installed";
}
