import crypto from "crypto";
import { cookies } from "next/headers";

const MINIAPP_SESSION_COOKIE = "ag_miniapp_session";
const MINIAPP_SESSION_TTL_SECONDS = 48 * 60 * 60;
const MINIAPP_SESSION_DOMAIN = "ads-galaxy-miniapp-session-v1";

type MiniappSessionPayload = {
  v: 1;
  uid: number;
  iat: number;
  exp: number;
};

function getSessionSecret() {
  const secret =
    process.env.MINIAPP_SESSION_SECRET ||
    process.env.ADMIN_SESSION_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "";

  // Session support must fail open. Missing configuration must never stop
  // normal Telegram initData authentication.
  return secret.length >= 32 ? secret : null;
}

function signPayload(encodedPayload: string, secret: string) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${MINIAPP_SESSION_DOMAIN}.${encodedPayload}`)
    .digest("base64url");
}

function secureEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function encodePayload(payload: MiniappSessionPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeSessionToken(token: string): MiniappSessionPayload | null {
  const secret = getSessionSecret();
  if (!secret) return null;

  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;

  const [encodedPayload, suppliedSignature] = parts;
  if (!encodedPayload || !suppliedSignature) return null;

  const expectedSignature = signPayload(encodedPayload, secret);

  if (!secureEqual(suppliedSignature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as MiniappSessionPayload;

    const now = Math.floor(Date.now() / 1000);

    if (
      payload.v !== 1 ||
      !Number.isInteger(payload.uid) ||
      payload.uid <= 0 ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      payload.exp <= now ||
      payload.iat > now + 300 ||
      payload.exp - payload.iat > MINIAPP_SESSION_TTL_SECONDS + 60
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export async function getMiniappSession() {
  try {
    const cookieStore = await cookies();
    const cookie = cookieStore.get(MINIAPP_SESSION_COOKIE);

    if (!cookie?.value) return null;

    return decodeSessionToken(cookie.value);
  } catch {
    return null;
  }
}

export async function setMiniappSession(userId: number) {
  const secret = getSessionSecret();

  if (!secret || !Number.isInteger(userId) || userId <= 0) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);

  const payload: MiniappSessionPayload = {
    v: 1,
    uid: userId,
    iat: now,
    exp: now + MINIAPP_SESSION_TTL_SECONDS,
  };

  const encodedPayload = encodePayload(payload);
  const token = `${encodedPayload}.${signPayload(encodedPayload, secret)}`;

  try {
    const cookieStore = await cookies();

    cookieStore.set(MINIAPP_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: MINIAPP_SESSION_TTL_SECONDS,
      path: "/",
    });

    return true;
  } catch {
    // A cookie write failure must never break Telegram authentication.
    return false;
  }
}

export async function clearMiniappSession() {
  try {
    const cookieStore = await cookies();

    cookieStore.set(MINIAPP_SESSION_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      expires: new Date(0),
      path: "/",
    });

    return true;
  } catch {
    return false;
  }
}
