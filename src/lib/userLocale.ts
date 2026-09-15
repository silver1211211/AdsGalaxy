import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { DEFAULT_LOCALE, isLocale, translate, type Locale, type TranslationKey, type TranslationValues } from "@/i18n";
import { sendTelegramMessage } from "@/lib/telegram";

export type LocaleDb = typeof pool | PoolConnection;

export function resolveUserLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getUserLocale(userId: number, db: LocaleDb = pool): Promise<Locale> {
  const [rows] = await db.query<Array<RowDataPacket & { language: unknown }>>(
    "SELECT language FROM users WHERE id = ? LIMIT 1",
    [userId],
  );
  const user = rows[0];
  return resolveUserLocale(user?.language);
}

export async function setUserLocale(userId: number, locale: Locale, db: LocaleDb = pool) {
  await db.query("UPDATE users SET language = ? WHERE id = ?", [locale, userId]);
}

export async function tForUser(
  userId: number,
  key: TranslationKey,
  values: TranslationValues = {},
  db: LocaleDb = pool,
) {
  const locale = await getUserLocale(userId, db);
  return { locale, text: translate(key, values, locale) };
}

export async function sendLocalizedTelegramMessage(
  userId: number,
  key: TranslationKey,
  values: TranslationValues = {},
  options: Record<string, unknown> = {},
  db: LocaleDb = pool,
) {
  const [rows] = await db.query<Array<RowDataPacket & { telegram_id: unknown; language: unknown }>>(
    "SELECT telegram_id, language FROM users WHERE id = ? LIMIT 1",
    [userId],
  );
  const user = rows[0];
  if (!user?.telegram_id) return null;
  const locale = resolveUserLocale(user.language);
  return sendTelegramMessage(
    String(user.telegram_id),
    translate(key, values, locale),
    options,
  );
}
