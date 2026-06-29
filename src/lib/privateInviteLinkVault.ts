import "server-only";

import crypto from "crypto";

const VERSION = "v1";

function encryptionSecret() {
  return process.env.PRIVATE_INVITE_LINK_ENCRYPTION_KEY
    || process.env.INVITE_LINK_HASH_SECRET
    || process.env.AUTH_SECRET
    || process.env.ADMIN_SESSION_SECRET
    || process.env.BOT_TOKEN
    || "";
}

function encryptionKey() {
  const secret = encryptionSecret();
  if (!secret) return null;
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptPrivateInviteLink(value: unknown) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;

  const key = encryptionKey();
  if (!key) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptPrivateInviteLink(value: unknown) {
  const encoded = String(value || "").trim();
  if (!encoded) return null;

  const key = encryptionKey();
  if (!key) return null;

  const [version, iv, tag, encrypted] = encoded.split(":");
  if (version !== VERSION || !iv || !tag || !encrypted) return null;

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
