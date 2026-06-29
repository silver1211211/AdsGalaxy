import "server-only";

import crypto from "crypto";
import { normalizePrivateInviteLink } from "@/lib/telegramChannelInput";

const TOKEN_VERSION = 1;
const TOKEN_TTL_MS = 30 * 60 * 1000;

type VerificationPayload = {
  v: number;
  chatId: string;
  inviteDigest: string;
  expiresAt: number;
};

export type PrivateChannelTokenInspection = {
  valid: boolean;
  errorCode: string;
  tokenReceived: boolean;
  tokenHasChatId: boolean;
  digestMatch: boolean;
  chatId?: string;
};

function invalidInspection(
  errorCode: string,
  input: Partial<Pick<PrivateChannelTokenInspection, "tokenReceived" | "tokenHasChatId" | "digestMatch">> = {}
): PrivateChannelTokenInspection {
  return {
    valid: false,
    errorCode,
    tokenReceived: input.tokenReceived ?? false,
    tokenHasChatId: input.tokenHasChatId ?? false,
    digestMatch: input.digestMatch ?? false,
  };
}

function signingKey() {
  const secret = process.env.PRIVATE_INVITE_LINK_ENCRYPTION_KEY
    || process.env.INVITE_LINK_HASH_SECRET
    || process.env.AUTH_SECRET
    || process.env.ADMIN_SESSION_SECRET
    || process.env.BOT_TOKEN
    || "";
  return secret ? crypto.createHash("sha256").update(secret).digest() : null;
}

function inviteDigest(inviteLink: string, key: Buffer) {
  return crypto.createHmac("sha256", key).update(inviteLink).digest("base64url");
}

function signature(payload: string, key: Buffer) {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

export function createPrivateChannelVerificationToken(chatId: unknown, inviteLink: unknown) {
  const key = signingKey();
  const normalizedInviteLink = normalizePrivateInviteLink(inviteLink);
  const normalizedChatId = String(chatId || "").trim();
  if (!key || !normalizedInviteLink || !normalizedChatId) return null;

  const payload = Buffer.from(JSON.stringify({
    v: TOKEN_VERSION,
    chatId: normalizedChatId,
    inviteDigest: inviteDigest(normalizedInviteLink, key),
    expiresAt: Date.now() + TOKEN_TTL_MS,
  } satisfies VerificationPayload), "utf8").toString("base64url");

  return `${payload}.${signature(payload, key)}`;
}

export function inspectPrivateChannelVerificationToken(token: unknown, inviteLink: unknown, expectedChatId?: unknown): PrivateChannelTokenInspection {
  const key = signingKey();
  const normalizedInviteLink = normalizePrivateInviteLink(inviteLink);
  const encoded = String(token || "").trim();
  if (!key) return invalidInspection("signing_key_missing", { tokenReceived: Boolean(encoded) });
  if (!normalizedInviteLink) return invalidInspection("normalized_invite_invalid", { tokenReceived: Boolean(encoded) });
  if (!encoded) return invalidInspection("token_missing");

  const [payload, providedSignature] = encoded.split(".");
  if (!payload || !providedSignature) return invalidInspection("token_malformed", { tokenReceived: true });

  const expectedSignature = signature(payload, key);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return invalidInspection("signature_mismatch", { tokenReceived: true });
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as VerificationPayload;
    const normalizedExpectedChatId = String(expectedChatId || "").trim();
    const tokenHasChatId = Boolean(parsed.chatId);
    const digestMatch = parsed.inviteDigest === inviteDigest(normalizedInviteLink, key);
    const details = { tokenReceived: true, tokenHasChatId, digestMatch };

    if (parsed.v !== TOKEN_VERSION) return invalidInspection("version_mismatch", details);
    if (parsed.expiresAt <= Date.now()) return invalidInspection("token_expired", details);
    if (!tokenHasChatId) return invalidInspection("token_chat_id_missing", details);
    if (normalizedExpectedChatId && parsed.chatId !== normalizedExpectedChatId) return invalidInspection("chat_id_mismatch", details);
    if (!digestMatch) return invalidInspection("digest_mismatch", details);
    return {
      valid: true,
      errorCode: "none",
      tokenReceived: true,
      tokenHasChatId: true,
      digestMatch: true,
      chatId: parsed.chatId,
    };
  } catch {
    return invalidInspection("payload_invalid", { tokenReceived: true });
  }
}

export function verifyPrivateChannelVerificationToken(token: unknown, inviteLink: unknown, expectedChatId?: unknown) {
  const inspection = inspectPrivateChannelVerificationToken(token, inviteLink, expectedChatId);
  return inspection.valid && inspection.chatId ? { chatId: inspection.chatId } : null;
}
