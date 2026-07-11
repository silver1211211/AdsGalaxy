import "server-only";

import crypto from "crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { loadBotToken } from "@/lib/botIntegration";
import { sendTelegramMessage } from "@/lib/telegram";

export const BOT_USER_VERIFICATION_IMAGE_URL = "https://i.ibb.co/sd79Stcx/IMG-4980.jpg";
export const BOT_USER_VERIFICATION_REFERRAL_URL = "https://t.me/Ads_Galaxy_bot?startapp=REF770190998629F";
export const BOT_USER_VERIFICATION_MESSAGE =
  `🌌 <b>Discover AdsGalaxy</b>\n\n` +
  `This sponsored message is powered by AdsGalaxy.\n\n` +
  `💰 Monetize your:\n\n` +
  `• Telegram Bot\n` +
  `• Public Channel\n` +
  `• Private Channel\n` +
  `• Telegram Mini App\n\n` +
  `📢 Advertisers can promote products across Telegram Bots, Channels and Mini Apps through the AdsGalaxy network.\n\n` +
  `Start today:\n\n${BOT_USER_VERIFICATION_REFERRAL_URL}`;

type VerificationCandidate = RowDataPacket & {
  id: number;
  bot_id: number;
  chat_id: string;
  verification_attempt_count: number;
  bot_token: string | null;
  bot_token_encrypted: string | null;
};

export type TelegramRecipientFailure = {
  kind: "permanent" | "transient";
  reason: string;
};

const PERMANENT_RECIPIENT_PATTERNS = [
  "bot was blocked by the user",
  "user is deactivated",
  "chat not found",
  "user not found",
  "bot can't initiate conversation",
  "bot cannot initiate conversation",
  "forbidden",
  "recipient unavailable",
  "peer_id_invalid",
];

export function classifyTelegramRecipientFailure(input: { status?: number; description?: unknown; error?: unknown }): TelegramRecipientFailure {
  const reason = String(input.description || (input.error instanceof Error ? input.error.message : input.error) || "Telegram delivery failed").slice(0, 500);
  const normalized = reason.toLowerCase();
  const permanent = PERMANENT_RECIPIENT_PATTERNS.some((pattern) => normalized.includes(pattern));
  return { kind: permanent ? "permanent" : "transient", reason };
}

async function claimCandidate(db: Pool): Promise<{ candidate: VerificationCandidate; claimToken: string } | null> {
  const claimToken = crypto.randomUUID();
  const [claim]: any = await db.query(
    `UPDATE bot_users bu
     JOIN bots b ON b.id = bu.bot_id
     JOIN users owner ON owner.id = b.user_id
     SET bu.verification_claim_token = ?,
         bu.verification_claim_expires_at = DATE_ADD(NOW(), INTERVAL 5 MINUTE),
         bu.verification_last_attempt_at = NOW(),
         bu.verification_attempt_count = bu.verification_attempt_count + 1
     WHERE bu.status = 'pending_verification'
       AND bu.is_active = FALSE
       AND bu.source IN ('manual_publisher', 'manual_admin')
       AND bu.chat_id IS NOT NULL AND bu.chat_id <> ''
       AND (bu.verification_next_attempt_at IS NULL OR bu.verification_next_attempt_at <= NOW())
       AND (bu.verification_claim_token IS NULL OR bu.verification_claim_expires_at < NOW())
       AND CAST(bu.chat_id AS CHAR) <> CAST(owner.telegram_id AS CHAR)
       AND b.status = 'active' AND b.is_deleted = FALSE
       AND COALESCE(b.health_status, 'active') IN ('active', 'healthy')
     ORDER BY bu.id ASC
     LIMIT 1`,
    [claimToken]
  );
  if (claim.affectedRows !== 1) return null;
  const [rows] = await db.query<VerificationCandidate[]>(
    `SELECT bu.id, bu.bot_id, bu.chat_id, bu.verification_attempt_count,
            b.bot_token, b.bot_token_encrypted
     FROM bot_users bu JOIN bots b ON b.id = bu.bot_id
     WHERE bu.verification_claim_token = ? LIMIT 1`,
    [claimToken]
  );
  return rows[0] ? { candidate: rows[0], claimToken } : null;
}

export async function processPendingBotUserVerifications(limit = 50, db: Pool = pool) {
  const result = { processed: 0, activated: 0, inactive: 0, retrying: 0 };
  for (let index = 0; index < limit; index += 1) {
    const claimed = await claimCandidate(db);
    if (!claimed) break;
    const { candidate, claimToken } = claimed;
    result.processed += 1;
    try {
      const token = await loadBotToken(db, candidate);
      const response = await sendTelegramMessage(candidate.chat_id, BOT_USER_VERIFICATION_MESSAGE, {
        token,
        photo: BOT_USER_VERIFICATION_IMAGE_URL,
        parse_mode: "HTML",
      });
      if (response?.ok) {
        const [update]: any = await db.query(
          `UPDATE bot_users
           SET status = 'active', is_active = TRUE, inactive_reason = NULL,
               verification_success_at = NOW(), verification_message_id = ?,
               verification_last_error = NULL, verification_next_attempt_at = NULL,
               verification_claim_token = NULL, verification_claim_expires_at = NULL,
               last_successful_delivery_at = NOW()
           WHERE id = ? AND verification_claim_token = ? AND status = 'pending_verification'`,
          [response.result?.message_id || null, candidate.id, claimToken]
        );
        result.activated += update.affectedRows;
        continue;
      }
      const failure = classifyTelegramRecipientFailure({ status: response?.error_code, description: response?.description });
      if (failure.kind === "permanent") {
        await db.query(
          `UPDATE bot_users
           SET status = 'inactive', is_active = FALSE, inactive_reason = ?, last_health_failure_at = NOW(),
               verification_last_error = ?, verification_next_attempt_at = NULL,
               verification_claim_token = NULL, verification_claim_expires_at = NULL
           WHERE id = ? AND verification_claim_token = ? AND status = 'pending_verification'`,
          [failure.reason, failure.reason, candidate.id, claimToken]
        );
        result.inactive += 1;
      } else {
        const retryAt = new Date(Date.now() + Math.min(60, 2 ** Math.min(candidate.verification_attempt_count, 6)) * 60_000);
        await db.query(
          `UPDATE bot_users
           SET verification_last_error = ?, verification_next_attempt_at = ?,
               verification_claim_token = NULL, verification_claim_expires_at = NULL
           WHERE id = ? AND verification_claim_token = ? AND status = 'pending_verification'`,
          [failure.reason, retryAt, candidate.id, claimToken]
        );
        result.retrying += 1;
      }
    } catch (error) {
      const failure = classifyTelegramRecipientFailure({ error });
      const retryAt = new Date(Date.now() + Math.min(60, 2 ** Math.min(candidate.verification_attempt_count, 6)) * 60_000);
      await db.query(
        `UPDATE bot_users
         SET verification_last_error = ?, verification_next_attempt_at = ?,
             verification_claim_token = NULL, verification_claim_expires_at = NULL
         WHERE id = ? AND verification_claim_token = ? AND status = 'pending_verification'`,
        [failure.reason, retryAt, candidate.id, claimToken]
      );
      result.retrying += 1;
    }
  }
  return result;
}
