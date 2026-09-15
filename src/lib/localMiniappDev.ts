import type { ResultSetHeader, RowDataPacket } from "mysql2";
import pool from "./db";
import { processReferralJoinReward } from "./referralSprint";
import {
  blockReferralIfSelfDevice,
  getReferralSecuritySignals,
  markReferralJoinSignals,
  updateUserReferralSecuritySignals,
} from "./referralSecurity";

class LocalMiniappDevBannedUserError extends Error {
  constructor() {
    super("Account restricted");
    this.name = "BannedUserError";
  }
}

export const LOCAL_MINIAPP_DEV_STORAGE_KEY = "adsgalaxy_local_miniapp_dev";
export const LOCAL_MINIAPP_DEV_INIT_DATA_PREFIX = "adsgalaxy-local-miniapp-dev:";

type LocalMiniappDevUser = {
  key: string;
  telegram_id: string;
  first_name: string;
  last_name: string;
  username: string;
  existing_username?: string;
};

type LocalMiniappDevUserRow = RowDataPacket & {
  id: number;
  status?: string;
  is_banned?: number;
};

type ReferralCodeRow = RowDataPacket & { referral_code: string };
type ReferrerRow = RowDataPacket & { id: number };

const LOCAL_MINIAPP_DEV_USERS: LocalMiniappDevUser[] = [
  {
    key: "1",
    telegram_id: "999001",
    first_name: "Local",
    last_name: "Tester",
    username: "local_tester",
  },
  {
    key: "2",
    telegram_id: "999002",
    first_name: "Local",
    last_name: "Tester Two",
    username: "local_tester_2",
  },
  {
    key: "silver",
    telegram_id: "",
    first_name: "",
    last_name: "",
    username: "Silver_Got_paid",
    existing_username: "Silver_Got_paid",
  },
];

function normalizeHostname(hostname: string | null) {
  return String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

function getRequestHostname(request?: Request) {
  const forwardedHost = request?.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || "";
  return normalizeHostname(forwardedHost || request?.headers.get("host") || "");
}

export function isLocalMiniappDevHost(hostname: string | null) {
  const host = normalizeHostname(hostname);
  return host === "localhost"
    || host === "127.0.0.1"
    || host === "preview.adsgalaxy.online";
}

export function isLocalMiniappDevServerAllowed(hostname: string | null) {
  return process.env.NODE_ENV !== "production"
    && process.env.ENABLE_LOCAL_MINIAPP_DEV === "true"
    && isLocalMiniappDevHost(hostname);
}

export function getLocalMiniappDevUser(userKey: string | null) {
  return LOCAL_MINIAPP_DEV_USERS.find((user) => user.key === userKey)
    || LOCAL_MINIAPP_DEV_USERS[0];
}

function encodeDevPayload(payload: unknown) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeDevPayload(value: string) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
    user?: string;
    ref?: string;
  };
}

export function buildLocalMiniappDevInitData(userKey: string | null, ref: string | null) {
  const user = getLocalMiniappDevUser(userKey);
  return `${LOCAL_MINIAPP_DEV_INIT_DATA_PREFIX}${encodeDevPayload({
    user: user.key,
    ref: ref || "",
  })}`;
}

export function parseLocalMiniappDevInitData(initData: string | null) {
  if (!initData?.startsWith(LOCAL_MINIAPP_DEV_INIT_DATA_PREFIX)) return null;

  try {
    const payload = decodeDevPayload(initData.slice(LOCAL_MINIAPP_DEV_INIT_DATA_PREFIX.length));
    return {
      user: getLocalMiniappDevUser(payload.user || null),
      ref: typeof payload.ref === "string" ? payload.ref.trim() : "",
    };
  } catch {
    return null;
  }
}

async function resolveLocalReferralCode(ref: string) {
  const cleanRef = ref.trim();
  if (!cleanRef) return "";

  const candidates = cleanRef.startsWith("AGX")
    ? [cleanRef]
    : [cleanRef, `AGX${cleanRef}`];

  const [rows] = await pool.query<ReferralCodeRow[]>(
    `SELECT referral_code FROM users WHERE referral_code IN (?, ?) OR telegram_id = ? LIMIT 1`,
    [candidates[0], candidates[1] || candidates[0], cleanRef]
  );

  return rows[0]?.referral_code || cleanRef;
}

export async function getLocalMiniappDevAuthenticatedUser(initData: string, options: { allowBanned?: boolean; request?: Request } = {}) {
  const parsed = parseLocalMiniappDevInitData(initData);
  if (!parsed) {
    throw new Error("Unauthorized: Invalid local Mini App dev token");
  }

  // The public preview hostname is the owner's design-review environment.
  // Resolve it to the real read-only account automatically, regardless of
  // stale localStorage tokens left by the earlier fake preview identity.
  const tgUser = getRequestHostname(options.request) === "preview.adsgalaxy.online"
    ? getLocalMiniappDevUser("silver")
    : parsed.user;
  const securitySignals = getReferralSecuritySignals(options.request);

  // This preview-only identity reads the existing account directly. It never
  // upserts profile data or writes activity/referral security signals, so
  // opening the preview cannot alter the owner's production account record.
  if (tgUser.existing_username) {
    const [existingRows] = await pool.query<LocalMiniappDevUserRow[]>(
      "SELECT * FROM users WHERE username = ? LIMIT 1",
      [tgUser.existing_username]
    );
    const existingUser = existingRows[0];
    if (!existingUser) {
      throw new Error("Preview account is unavailable");
    }

    const userStatus = String(existingUser.status || "").toLowerCase();
    const legacyBanned = existingUser.status === undefined && Number(existingUser.is_banned || 0) === 1;
    if (!options.allowBanned && (userStatus === "banned" || legacyBanned)) {
      throw new LocalMiniappDevBannedUserError();
    }
    return existingUser;
  }

  const referralCode = `AGX${tgUser.telegram_id}`;

  // Local-only Mini App development support. This creates/fetches deterministic
  // fake users without weakening Telegram initData validation in production.
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO users (telegram_id, first_name, last_name, username, photo_url, referral_code)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       first_name = VALUES(first_name),
       last_name = VALUES(last_name),
       username = VALUES(username),
       photo_url = VALUES(photo_url)`,
    [tgUser.telegram_id, tgUser.first_name, tgUser.last_name, tgUser.username, "", referralCode]
  );

  const [rows] = await pool.query<LocalMiniappDevUserRow[]>(
    "SELECT * FROM users WHERE telegram_id = ?",
    [tgUser.telegram_id]
  );
  const user = rows[0];
  if (!user) {
    throw new Error("Internal authentication error");
  }

  const userStatus = String(user.status || "").toLowerCase();
  const legacyBanned = user.status === undefined && Number(user.is_banned || 0) === 1;
  if (!options.allowBanned && (userStatus === "banned" || legacyBanned)) {
    throw new LocalMiniappDevBannedUserError();
  }

  if (result.insertId && parsed.ref) {
    const referrerCode = await resolveLocalReferralCode(parsed.ref);
    const [referrerRows] = await pool.query<ReferrerRow[]>(
      "SELECT id FROM users WHERE referral_code = ?",
      [referrerCode]
    );
    const invitedBy = Number(referrerRows[0]?.id || 0);
    if (invitedBy && invitedBy !== Number(user.id)) {
      const [referralResult] = await pool.query<ResultSetHeader>(
        "INSERT IGNORE INTO referrals (user_id, invited_by) VALUES (?, ?)",
        [user.id, invitedBy]
      );
      if (referralResult.affectedRows > 0) {
        await markReferralJoinSignals(Number(referralResult.insertId), securitySignals);
        const selfDevice = await blockReferralIfSelfDevice(Number(referralResult.insertId));
        if (!selfDevice.blocked) {
          await processReferralJoinReward(Number(referralResult.insertId));
        }
      }
    }
  }

  await updateUserReferralSecuritySignals(Number(user.id), securitySignals);
  return user;
}
