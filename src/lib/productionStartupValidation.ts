const PRODUCTION_REQUIRED_ENV = [
  "BOT_INTEGRATION_ENCRYPTION_KEY",
  "PRIVATE_INVITE_LINK_ENCRYPTION_KEY",
  "TELEGRAM_WEBHOOK_SECRET_TOKEN",
] as const;

const PRODUCTION_ENCRYPTION_KEYS = new Set<string>([
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

  const missing = PRODUCTION_REQUIRED_ENV.filter((key) => !clean(process.env[key]));
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
