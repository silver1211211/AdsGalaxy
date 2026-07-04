import crypto from "crypto";

export const TELEGRAM_PRODUCTION_ED25519_PUBLIC_KEY = "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d";
export const TELEGRAM_TEST_ED25519_PUBLIC_KEY = "40055058a4ee38156a06562e52eece92a771bcd8346a8c4615cb7376eddf72ec";
export const TELEGRAM_INIT_DATA_MAX_AGE_SECONDS = 86_400;

export type TelegramSdkUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  allows_write_to_pm?: boolean;
  photo_url?: string;
};

export type VerifiedThirdPartyInitData = {
  telegramUserId: string;
  user: TelegramSdkUser;
  authDate: number;
};

export class TelegramSdkAuthError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 401) {
    super(message);
    this.name = "TelegramSdkAuthError";
  }
}

export function assertTelegramSdkUserMatches(suppliedUserId: string, verifiedUserId: string) {
  if (suppliedUserId && suppliedUserId !== verifiedUserId) {
    throw new TelegramSdkAuthError("USER_MISMATCH", "telegram_user_id does not match verified Telegram initData", 403);
  }
}

function publicKeyObject(rawPublicKeyHex: string) {
  if (!/^[a-f0-9]{64}$/i.test(rawPublicKeyHex)) {
    throw new Error("Invalid Ed25519 public key");
  }
  // RFC 8410 SubjectPublicKeyInfo prefix for a raw 32-byte Ed25519 key.
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(rawPublicKeyHex, "hex")]);
  return crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
}

function decodeTelegramSignature(signature: string) {
  try {
    const normalized = signature.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="), "base64");
    if (decoded.length !== 64) throw new Error("Invalid signature length");
    return decoded;
  } catch {
    throw new TelegramSdkAuthError("INVALID_INIT_DATA", "Telegram initData signature is invalid");
  }
}

export function verifyTelegramThirdPartyInitData(
  initData: string,
  botId: string,
  options: { nowSeconds?: number; publicKeyHex?: string; maxAgeSeconds?: number } = {},
): VerifiedThirdPartyInitData {
  if (!/^\d+$/.test(botId)) {
    throw new TelegramSdkAuthError("MISSING_BOT_ID", "Mini App numeric Telegram bot ID is missing", 400);
  }

  const params = new URLSearchParams(initData);
  const signature = params.get("signature");
  if (!signature) {
    throw new TelegramSdkAuthError("TELEGRAM_SIGNATURE_MISSING", "Telegram initData signature is missing");
  }

  const sortedFields = Array.from(params.entries())
    .filter(([key]) => key !== "hash" && key !== "signature")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const dataCheckString = `${botId}:WebAppData\n${sortedFields}`;

  let valid = false;
  try {
    valid = crypto.verify(
      null,
      Buffer.from(dataCheckString, "utf8"),
      publicKeyObject(options.publicKeyHex || TELEGRAM_PRODUCTION_ED25519_PUBLIC_KEY),
      decodeTelegramSignature(signature),
    );
  } catch (error) {
    if (error instanceof TelegramSdkAuthError) throw error;
  }
  if (!valid) {
    throw new TelegramSdkAuthError("INVALID_INIT_DATA", "Telegram initData signature verification failed");
  }

  const authDate = Number(params.get("auth_date"));
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAge = options.maxAgeSeconds ?? TELEGRAM_INIT_DATA_MAX_AGE_SECONDS;
  if (!Number.isInteger(authDate) || authDate <= 0 || authDate > now + 300 || now - authDate > maxAge) {
    throw new TelegramSdkAuthError("INIT_DATA_EXPIRED", "Telegram initData has expired");
  }

  const rawUser = params.get("user");
  try {
    const user = JSON.parse(rawUser || "") as TelegramSdkUser;
    if (!Number.isSafeInteger(user?.id) || user.id <= 0) throw new Error("Invalid user ID");
    return { telegramUserId: String(user.id), user, authDate };
  } catch {
    throw new TelegramSdkAuthError("INVALID_INIT_DATA", "Telegram initData user is invalid");
  }
}
