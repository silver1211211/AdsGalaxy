import crypto from "crypto";
import pool from "./db";
import { escapeTelegramHtml, sendTelegramMessage } from "./telegram";
import { getLocalMiniappDevAuthenticatedUser, parseLocalMiniappDevInitData } from "./localMiniappDev";
import { processReferralJoinReward } from "./referralSprint";
import {
  blockReferralIfSelfDevice,
  getReferralSecuritySignals,
  markReferralJoinSignals,
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
        "UPDATE users SET first_name = ?, last_name = ?, username = ?, photo_url = ? WHERE telegram_id = ?",
        [tgUser.first_name, tgUser.last_name || "", tgUser.username || "", tgUser.photo_url || "", telegramId]
      );
      await updateUserReferralSecuritySignals(Number(rows[0].id), securitySignals);
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

      // Handle referral if start_param exists (only for truly new users with a fresh insertId)
      if (result.insertId && tgUser.start_param) {
        const [referrerRows]: any = await pool.query(
          "SELECT id, telegram_id, first_name FROM users WHERE referral_code = ?",
          [tgUser.start_param]
        );
        if (referrerRows.length > 0) {
          const invitedBy = referrerRows[0].id;
          const referrerTgId = referrerRows[0].telegram_id;
          const referrerName = referrerRows[0].first_name;

          if (Number(invitedBy) !== Number(newUserId)) {
            const [referralResult]: any = await pool.query(
              "INSERT IGNORE INTO referrals (user_id, invited_by) VALUES (?, ?)",
              [newUserId, invitedBy]
            );
            let referralBlocked = false;
            if (referralResult.affectedRows > 0) {
              await markReferralJoinSignals(Number(referralResult.insertId), securitySignals);
              const selfDevice = await blockReferralIfSelfDevice(Number(referralResult.insertId));
              referralBlocked = selfDevice.blocked;
              if (!referralBlocked) {
                await processReferralJoinReward(Number(referralResult.insertId));
              }
            }

            if (!referralBlocked) {
              await sendTelegramMessage(
                referrerTgId,
                `<b>New Referral Joined!</b>\n\nHi ${escapeTelegramHtml(referrerName)}, someone joined with your referral code. You earned the instant join reward; the verification bonus unlocks after they join and verify the required channel.`,
                { parse_mode: "HTML" }
              );
            }
          }
        }
      }

      const [newUser]: any = await pool.query("SELECT * FROM users WHERE id = ?", [newUserId]);
      if (newUserId) {
        await updateUserReferralSecuritySignals(Number(newUserId), securitySignals);
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
