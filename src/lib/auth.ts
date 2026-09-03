import crypto from "crypto";
import pool from "./db";
import { getLocalMiniappDevAuthenticatedUser, parseLocalMiniappDevInitData } from "./localMiniappDev";
import { attributeReferral, finalizeStoredReferralForUser } from "./referralAttribution";
import {
  getReferralSecuritySignals,
  updateUserReferralSecuritySignals,
} from "./referralSecurity";

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  allows_write_to_pm?: boolean;
  photo_url?: string;
}

export class BannedUserError extends Error {
  statusCode = 403;

  constructor() {
    super("Account restricted");
    this.name = "BannedUserError";
  }
}

export function isBannedUserError(error: unknown) {
  return error instanceof BannedUserError
    || (error instanceof Error && error.name === "BannedUserError");
}

export function getAuthErrorStatus(error: unknown) {
  return isBannedUserError(error) ? 403 : 500;
}

export function validateInitData(initData: string, botToken: string) {
  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get("hash");
  urlParams.delete("hash");

  // Sort fields alphabetically
  const sortedParams = Array.from(urlParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const checkHash = crypto
    .createHmac("sha256", secretKey)
    .update(sortedParams)
    .digest("hex");

  if (checkHash !== hash) {
    throw new Error("Invalid initData: Hash mismatch");
  }

  // Check auth_date to prevent outdated data (e.g., older than 24 hours)
  const authDate = parseInt(urlParams.get("auth_date") || "0");
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 86400) {
    throw new Error("Invalid initData: Data is too old");
  }

  const userJSON = urlParams.get("user");
  if (!userJSON) {
    throw new Error("Invalid initData: No user data");
  }

  const user = JSON.parse(userJSON) as TelegramUser;
  // Capture start_param if it exists
  const startParam = urlParams.get("start_param");

  return { ...user, start_param: startParam };
}

/**
 * Validates the request and returns the user object from the DB.
 * If user doesn't exist, it creates one.
 */
export async function getAuthenticatedUser(initData: string | null, options: { allowBanned?: boolean; request?: Request } = {}) {
  if (!initData || initData === 'undefined' || initData === 'null') {
    throw new Error("Unauthorized: No initData provided");
  }

  if (parseLocalMiniappDevInitData(initData)) {
    if (process.env.NODE_ENV === "production" || process.env.ENABLE_LOCAL_MINIAPP_DEV !== "true") {
      throw new Error("Unauthorized: Local Mini App dev auth is disabled");
    }

    return getLocalMiniappDevAuthenticatedUser(initData, options);
  }

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    throw new Error("Server configuration error: BOT_TOKEN not set");
  }

  const tgUser = validateInitData(initData, botToken) as TelegramUser & { start_param?: string };
  const telegramId = String(tgUser.id);
  const securitySignals = getReferralSecuritySignals(options.request);

  try {
    // Check if user exists
    const [rows]: any = await pool.query(
      "SELECT * FROM users WHERE telegram_id = ?",
      [telegramId]
    );

    if (rows.length > 0) {
      const userStatus = String(rows[0].status || "").toLowerCase();
      const legacyBanned = rows[0].status === undefined && Number(rows[0].is_banned || 0) === 1;
      if (!options.allowBanned && (userStatus === "banned" || legacyBanned)) {
        throw new BannedUserError();
      }

      // Update existing user info
      await pool.query(
        "UPDATE users SET first_name = ?, last_name = ?, username = ?, photo_url = ?, last_active_at = NOW() WHERE telegram_id = ?",
        [tgUser.first_name, tgUser.last_name || "", tgUser.username || "", tgUser.photo_url || "", telegramId]
      );
      await updateUserReferralSecuritySignals(Number(rows[0].id), securitySignals);
      if (tgUser.start_param) {
        await attributeReferral({
          userId: Number(rows[0].id),
          token: tgUser.start_param,
          signals: securitySignals,
        });
      }
      await finalizeStoredReferralForUser(Number(rows[0].id), securitySignals);
      return rows[0];
    } else {
      // Create new user — ON DUPLICATE KEY UPDATE guards against concurrent first-login races.
      const referralCode = `AGX${telegramId}`;

      const [result]: any = await pool.query(
        `INSERT INTO users (telegram_id, first_name, last_name, username, photo_url, referral_code)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           first_name = VALUES(first_name),
           last_name = VALUES(last_name),
           username = VALUES(username),
           photo_url = VALUES(photo_url)`,
        [telegramId, tgUser.first_name, tgUser.last_name || "", tgUser.username || "", tgUser.photo_url || "", referralCode]
      );

      // insertId is 0 when the ON DUPLICATE KEY UPDATE path was taken.
      // In that case, fetch the existing user by telegram_id instead.
      let newUserId: number | null = result.insertId || null;
      if (!newUserId) {
        const [existing]: any = await pool.query(
          "SELECT id FROM users WHERE telegram_id = ?",
          [telegramId]
        );
        newUserId = existing[0]?.id || null;
      }

      // Telegram delivers startapp payloads as signed start_param init data.
      // Attribute through the same shared workflow used by the bot /start flow.
      if (newUserId && tgUser.start_param) {
        await attributeReferral({
          userId: Number(newUserId),
          token: tgUser.start_param,
          signals: securitySignals,
        });
      }

      const [newUser]: any = await pool.query("SELECT * FROM users WHERE id = ?", [newUserId]);
      if (newUserId) {
        await pool.query("UPDATE users SET last_active_at = NOW() WHERE id = ?", [newUserId]);
        await updateUserReferralSecuritySignals(Number(newUserId), securitySignals);
        await finalizeStoredReferralForUser(Number(newUserId), securitySignals);
      }
      return newUser[0];
    }
  } catch (error) {
    if (isBannedUserError(error)) {
      throw error;
    }

    throw new Error("Internal authentication error");
  }
}

/**
 * Read-only authentication for latency-sensitive bootstrap checks.
 *
 * Do not replace this with getAuthenticatedUser(): that function deliberately
 * refreshes profile/referral metadata and can wait on write locks held by the
 * ad-processing workload. App bootstrap only needs the current account state.
 */
export async function getAuthenticatedUserStatus(
  initData: string | null,
  options: { request?: Request } = {},
) {
  if (!initData || initData === "undefined" || initData === "null") {
    throw new Error("Unauthorized: No initData provided");
  }

  if (parseLocalMiniappDevInitData(initData)) {
    if (process.env.NODE_ENV === "production" || process.env.ENABLE_LOCAL_MINIAPP_DEV !== "true") {
      throw new Error("Unauthorized: Local Mini App dev auth is disabled");
    }
    return getLocalMiniappDevAuthenticatedUser(initData, { allowBanned: true });
  }

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    throw new Error("Server configuration error: BOT_TOKEN not set");
  }

  const telegramUser = validateInitData(initData, botToken) as TelegramUser & { start_param?: string };
  const [rows]: any = await pool.query({
    sql: `SELECT id, status, banned_at, ban_reason
          FROM users
          WHERE telegram_id = ?
          LIMIT 1`,
    timeout: 5000,
    values: [String(telegramUser.id)],
  });

  if (!rows[0]) {
    // A genuinely new user still needs the full creation/referral workflow.
    return getAuthenticatedUser(initData, { allowBanned: true });
  }

  await pool.query("UPDATE users SET last_active_at = NOW() WHERE id = ?", [rows[0].id]);

  const securitySignals = getReferralSecuritySignals(options.request);
  await updateUserReferralSecuritySignals(Number(rows[0].id), securitySignals);
  if (telegramUser.start_param) {
    await attributeReferral({
      userId: Number(rows[0].id),
      token: telegramUser.start_param,
      signals: securitySignals,
    });
  }
  await finalizeStoredReferralForUser(Number(rows[0].id), securitySignals);

  return rows[0];
}
