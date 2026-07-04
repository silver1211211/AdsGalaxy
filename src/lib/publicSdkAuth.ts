import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { assertTelegramSdkUserMatches, TelegramSdkAuthError, verifyTelegramThirdPartyInitData } from "@/lib/telegramThirdPartyInitData";

export type PublicSdkUser = {
  telegramUserId: string;
  rawUser: ReturnType<typeof verifyTelegramThirdPartyInitData>["user"];
};

type MiniAppAuthRow = RowDataPacket & {
  id: number;
  telegram_bot_id: string | number | null;
  is_deleted: number | boolean;
};

function sdkError(code: string, message: string, status = 400) {
  const error = new Error(message) as Error & { code: string; status: number };
  error.code = code;
  error.status = status;
  return error;
}

export async function requirePublicSdkUser(request: Request, miniappId: number, suppliedUserId?: string): Promise<PublicSdkUser> {
  if (!Number.isInteger(miniappId) || miniappId <= 0) {
    throw sdkError("INVALID_APP", "Valid Mini App ID is required", 400);
  }

  const [miniapps] = await pool.query<MiniAppAuthRow[]>(
    "SELECT id, telegram_bot_id, is_deleted FROM miniapps WHERE id = ? LIMIT 1",
    [miniappId],
  );
  if (!miniapps[0] || Boolean(miniapps[0].is_deleted)) {
    throw sdkError("INVALID_APP", "Mini App not found", 404);
  }

  const botId = String(miniapps[0].telegram_bot_id || "").trim();
  if (!/^\d+$/.test(botId)) {
    throw sdkError("MISSING_BOT_ID", "Mini App numeric Telegram bot ID is missing", 400);
  }

  const initData = request.headers.get("x-telegram-init-data");
  if (!initData) {
    throw sdkError("INVALID_INIT_DATA", "Telegram initData is required; open this Mini App inside Telegram", 401);
  }

  try {
    const verified = verifyTelegramThirdPartyInitData(initData, botId);
    assertTelegramSdkUserMatches(suppliedUserId || "", verified.telegramUserId);

    await pool.query(
      `INSERT INTO miniapp_sdk_users
        (miniapp_id, telegram_user_id, first_name, last_name, username, language_code)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        first_name = VALUES(first_name), last_name = VALUES(last_name),
        username = VALUES(username), language_code = VALUES(language_code), last_seen_at = NOW()`,
      [miniappId, verified.telegramUserId, verified.user.first_name || "", verified.user.last_name || "", verified.user.username || "", verified.user.language_code || ""],
    );

    return { telegramUserId: verified.telegramUserId, rawUser: verified.user };
  } catch (error) {
    if (error instanceof TelegramSdkAuthError || (error instanceof Error && "code" in error)) throw error;
    throw sdkError("INVALID_INIT_DATA", "Telegram initData signature verification failed", 401);
  }
}

export function publicSdkErrorResponse(error: unknown, fallbackCode = "REQUEST_FAILED", fallbackMessage = "AdsGalaxy request failed") {
  const known = error as { code?: string; message?: string };
  return { success: false, error_code: known?.code || fallbackCode, message: known?.message || fallbackMessage };
}
