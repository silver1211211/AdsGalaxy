/* eslint-disable @typescript-eslint/no-explicit-any -- legacy referral rows are dynamically shaped */
import pool from "@/lib/db";
import { escapeTelegramHtml } from "@/lib/telegram";
import { sendLocalizedTelegramMessage } from "@/lib/userLocale";
import { processReferralJoinReward } from "@/lib/referralSprint";
import {
  blockReferralIfSelfDevice,
  markReferralJoinSignals,
  type ReferralSecuritySignals,
} from "@/lib/referralSecurity";

export type ReferralAttributionStatus =
  | "attributed"
  | "already_attributed"
  | "already_attributed_other"
  | "invalid_token"
  | "self_referral";

type TelegramReferralUser = {
  id: string | number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
};

const EMPTY_SIGNALS: ReferralSecuritySignals = { ip: "", userAgentHash: "", deviceHash: "" };

function validReferralToken(value: unknown) {
  const token = String(value || "").trim();
  return /^[A-Za-z0-9_-]{3,128}$/.test(token) ? token : "";
}

async function finalizeReferral(
  referralId: number,
  signals: ReferralSecuritySignals,
  notify: { userId: number; firstName: string } | null,
) {
  await markReferralJoinSignals(referralId, signals);
  const selfDevice = await blockReferralIfSelfDevice(referralId);
  if (selfDevice.blocked) return { blocked: true };

  await processReferralJoinReward(referralId);
  if (notify) {
    await sendLocalizedTelegramMessage(
      notify.userId,
      "bot.referral.joined.message",
      { name: escapeTelegramHtml(notify.firstName) },
      { parse_mode: "HTML" },
    );
  }
  return { blocked: false };
}

export async function ensureTelegramUserForReferral(user: TelegramReferralUser) {
  const telegramId = String(user.id);
  if (!/^\d{1,20}$/.test(telegramId)) throw new Error("invalid_telegram_user");

  await pool.query(
    `INSERT INTO users (telegram_id, first_name, last_name, username, photo_url, referral_code, official_bot_started_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       first_name = VALUES(first_name),
       last_name = VALUES(last_name),
       username = VALUES(username),
       photo_url = COALESCE(NULLIF(VALUES(photo_url), ''), photo_url),
       official_bot_started_at = NOW()`,
    [telegramId, user.first_name || "", user.last_name || "", user.username || "", user.photo_url || "", `AGX${telegramId}`],
  );
  const [rows]: any = await pool.query("SELECT * FROM users WHERE telegram_id = ? LIMIT 1", [telegramId]);
  if (!rows[0]) throw new Error("telegram_user_not_created");
  return rows[0];
}

export async function attributeReferral(input: {
  userId: number;
  token: unknown;
  signals?: ReferralSecuritySignals;
  deferFinalization?: boolean;
}): Promise<{ status: ReferralAttributionStatus; referralId?: number }> {
  const token = validReferralToken(input.token);
  if (!token) return { status: "invalid_token" };

  const conn = await pool.getConnection();
  let created = false;
  let referralId = 0;
  let referrerUserId = 0;
  let referrerFirstName = "";
  try {
    await conn.beginTransaction();
    const [users]: any = await conn.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [input.userId]);
    if (!users[0]) {
      await conn.rollback();
      return { status: "invalid_token" };
    }

    const [promotionLinks]: any = await conn.query(
      `SELECT pl.id link_id, pl.campaign_id, u.id, u.telegram_id, u.first_name
       FROM publisher_promotion_referral_links pl
       JOIN users u ON u.id = pl.promoter_user_id
       WHERE pl.token = ? LIMIT 1`,
      [token],
    );
    const [normalReferrers]: any = promotionLinks.length
      ? [[]]
      : await conn.query(
          "SELECT id, telegram_id, first_name FROM users WHERE referral_code = ? LIMIT 1",
          [token],
        );
    const referrer = promotionLinks[0] || normalReferrers[0];
    if (!referrer) {
      await conn.rollback();
      return { status: "invalid_token" };
    }
    if (Number(referrer.id) === Number(input.userId)) {
      await conn.rollback();
      return { status: "self_referral" };
    }

    const [existing]: any = await conn.query(
      "SELECT id, invited_by FROM referrals WHERE user_id = ? LIMIT 1 FOR UPDATE",
      [input.userId],
    );
    if (existing[0]) {
      await conn.commit();
      referralId = Number(existing[0].id);
      if (Number(existing[0].invited_by) !== Number(referrer.id)) {
        return { status: "already_attributed_other", referralId };
      }
      if (!input.deferFinalization) {
        await finalizeReferral(referralId, input.signals || EMPTY_SIGNALS, null);
      }
      return { status: "already_attributed", referralId };
    }

    const [inserted]: any = await conn.query(
      "INSERT IGNORE INTO referrals (user_id, invited_by) VALUES (?, ?)",
      [input.userId, referrer.id],
    );
    if (!inserted.affectedRows) {
      const [raced]: any = await conn.query(
        "SELECT id, invited_by FROM referrals WHERE user_id = ? LIMIT 1",
        [input.userId],
      );
      await conn.commit();
      referralId = Number(raced[0]?.id || 0);
      return {
        status: Number(raced[0]?.invited_by) === Number(referrer.id)
          ? "already_attributed"
          : "already_attributed_other",
        ...(referralId ? { referralId } : {}),
      };
    }

    created = true;
    referralId = Number(inserted.insertId);
    referrerUserId = Number(referrer.id);
    referrerFirstName = referrer.first_name || "User";
    if (promotionLinks.length) {
      await conn.query(
        `INSERT IGNORE INTO publisher_promotion_link_attributions
          (campaign_id, link_id, referral_id, promoter_user_id, referred_user_id)
         VALUES (?, ?, ?, ?, ?)`,
        [promotionLinks[0].campaign_id, promotionLinks[0].link_id, referralId, referrer.id, input.userId],
      );
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    conn.release();
  }

  if (created && !input.deferFinalization) {
    await finalizeReferral(
      referralId,
      input.signals || EMPTY_SIGNALS,
      { userId: referrerUserId, firstName: referrerFirstName },
    );
  }
  return { status: "attributed", referralId };
}

export async function finalizeStoredReferralForUser(userId: number, signals: ReferralSecuritySignals) {
  const [rows]: any = await pool.query("SELECT id FROM referrals WHERE user_id = ? LIMIT 1", [userId]);
  const referralId = Number(rows[0]?.id || 0);
  if (!referralId) return { status: "no_referral" as const };
  const result = await finalizeReferral(referralId, signals, null);
  return { status: result.blocked ? "blocked" as const : "finalized" as const, referralId };
}
