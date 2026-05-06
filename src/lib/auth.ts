import crypto from "crypto";
import pool from "./db";
import { sendTelegramMessage } from "./telegram";

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

  console.log("Auth: checkHash:", checkHash);
  console.log("Auth: receivedHash:", hash);

  if (checkHash !== hash) {
    console.error("Auth: Hash mismatch detected!");
    console.error("Auth: sortedParams used for check:", sortedParams);
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
export async function getAuthenticatedUser(initData: string | null) {
  console.log("Auth: Received initData:", initData ? (initData.substring(0, 20) + "...") : "MISSING");

  if (!initData || initData === 'undefined' || initData === 'null') {
    throw new Error("Unauthorized: No initData provided");
  }

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    throw new Error("Server configuration error: BOT_TOKEN not set");
  }

  const tgUser = validateInitData(initData, botToken) as TelegramUser & { start_param?: string };

  try {
    // Check if user exists
    const [rows]: any = await pool.query(
      "SELECT * FROM users WHERE telegram_id = ?",
      [tgUser.id]
    );

    if (rows.length > 0) {
      // Update existing user info
      await pool.query(
        "UPDATE users SET first_name = ?, last_name = ?, username = ?, photo_url = ? WHERE telegram_id = ?",
        [tgUser.first_name, tgUser.last_name || "", tgUser.username || "", tgUser.photo_url || "", tgUser.id]
      );
      return rows[0];
    } else {
      // Create new user
      // Generate a simple referral code if none exists
      const referralCode = `REF${tgUser.id}${Math.random().toString(36).substring(2, 5).toUpperCase()}`;

      const [result]: any = await pool.query(
        "INSERT INTO users (telegram_id, first_name, last_name, username, photo_url, referral_code) VALUES (?, ?, ?, ?, ?, ?)",
        [tgUser.id, tgUser.first_name, tgUser.last_name || "", tgUser.username || "", tgUser.photo_url || "", referralCode]
      );

      const newUserId = result.insertId;

      // Handle referral if start_param exists
      if (tgUser.start_param) {
        const [referrerRows]: any = await pool.query(
          "SELECT id, telegram_id, first_name FROM users WHERE referral_code = ?",
          [tgUser.start_param]
        );
        if (referrerRows.length > 0) {
          const invitedBy = referrerRows[0].id;
          const referrerTgId = referrerRows[0].telegram_id;
          const referrerName = referrerRows[0].first_name;

          // Record the referral in the new separate table
          await pool.query(
            "INSERT IGNORE INTO referrals (user_id, invited_by) VALUES (?, ?)",
            [newUserId, invitedBy]
          );

          // Notify Referrer
          const joinerName = tgUser.username ? `@${tgUser.username}` : tgUser.first_name;
          await sendTelegramMessage(
            referrerTgId,
            `<b>New Referral Joined!</b> 🚀\n\nHi ${referrerName}, <b>${joinerName}</b> just joined this platform using your referral link. You'll earn commissions from their future ad activities!`
          );
        }
      }

      const [newUser]: any = await pool.query("SELECT * FROM users WHERE id = ?", [newUserId]);
      return newUser[0];
    }
  } catch (error) {
    console.error("Auth Database Error:", error);
    throw new Error("Internal authentication error");
  }
}
