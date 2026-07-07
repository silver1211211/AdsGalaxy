const PRODUCTION_REQUIRED_ENV = [
  "DB_HOST",
  "DB_PORT",
  "DB_USER",
  "DB_PASS",
  "DB_NAME",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SDK_URL",
  "NEXT_PUBLIC_API_BASE_URL",
  "BOT_TOKEN",
  "ADMIN_SESSION_SECRET",
  "CRON_SECRET",
  "BOT_ADD_USER_SECRET",
  "MINIAPP_STATS_SECRET",
  "BOT_INTEGRATION_ENCRYPTION_KEY",
  "PRIVATE_INVITE_LINK_ENCRYPTION_KEY",
  "TELEGRAM_WEBHOOK_SECRET_TOKEN",
  "TELEGRAM_API_ID",
  "TELEGRAM_API_HASH",
  "TELEGRAM_MT_ACCOUNT_1_SESSION",
  "TELEGRAM_MT_ACCOUNT_2_SESSION",
  "TELEGRAM_BOT_USERNAME",
  "NEXT_PUBLIC_BOT_USERNAME",
  "TELEGRAM_NEWS_CHANNEL",
  "NEXT_PUBLIC_CHANNEL",
] as const;

const PRODUCTION_ENCRYPTION_KEYS = new Set<string>([
  "ADMIN_SESSION_SECRET",
  "BOT_INTEGRATION_ENCRYPTION_KEY",
  "PRIVATE_INVITE_LINK_ENCRYPTION_KEY",
]);

function clean(value: unknown) {
  return String(value || "").trim();
}

function isProductionRuntime() {
  return process.env.MODE === "PROD";
}

function invalidEncryptionKey(value: string) {
  if (value.length < 32) return true;
  if (/^[a-f0-9]+$/i.test(value) && value.length !== 64) return true;
  return false;
}

export function validateProductionStartupEnvironment() {
  if (!isProductionRuntime()) {
    return { ok: true as const, production: false, missing: [] as string[], invalid: [] as string[] };
  }

  const missing: string[] = PRODUCTION_REQUIRED_ENV.filter((key) => !clean(process.env[key]));
  if (clean(process.env.TELEGRAM_SUPPORT_SENDER_ENABLED).toLowerCase() === "true") {
    for (const key of ["TELEGRAM_SUPPORT_API_ID", "TELEGRAM_SUPPORT_API_HASH", "TELEGRAM_SUPPORT_SESSION"] as const) {
      if (!clean(process.env[key])) missing.push(key);
    }
  }
  const invalid = PRODUCTION_REQUIRED_ENV.filter((key) => {
    const value = clean(process.env[key]);
    return value && PRODUCTION_ENCRYPTION_KEYS.has(key) ? invalidEncryptionKey(value) : false;
  });

  if (missing.length > 0 || invalid.length > 0) {
    const details = [
      missing.length > 0 ? `missing: ${missing.join(", ")}` : "",
      invalid.length > 0 ? `invalid: ${invalid.join(", ")} must be at least 32 characters, or exactly 64 hex characters` : "",
    ].filter(Boolean).join("; ");
    throw new Error(`AdsGalaxy production startup validation failed (${details})`);
  }

  return { ok: true as const, production: true, missing: [] as string[], invalid: [] as string[] };
}
