import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { normalizePrivateInviteLink } from "@/lib/telegramChannelInput";
import { authoritativeMemberCount, parseFloodWait } from "@/lib/channelRefreshPolicy";

export type MtprotoAccountKey = "account_1" | "account_2";
export type MtprotoAccountNumber = 1 | 2;

export type MtprotoOperation = "membership" | "view_read" | "identity_lookup";

export type MtprotoAccountAvailability =
  | { available: true }
  | { available: false; code: string; retryAfterSeconds?: number };

type MtprotoViewDiagnostics = {
  verifiedAccounts: MtprotoAccountNumber[];
  attemptedAccounts: MtprotoAccountNumber[];
  cooldownAccounts: MtprotoAccountNumber[];
  requestsAttempted: number;
  actualFailures: number;
  retryAfterSeconds?: number;
};

export type PrivatePostViewResult =
  | ({ ok: true; views: number; account: MtprotoAccountKey } & MtprotoViewDiagnostics)
  | ({ ok: false; code: string } & MtprotoViewDiagnostics);

export type ChannelMemberCountResult = { ok: true; count: number; account: MtprotoAccountKey } | { ok: false; code: string; account?:MtprotoAccountKey; retryAfterSeconds?:number };

type PrivateInviteResolveResult =
  | { ok: true; chatId: string; title: string; participantsCount: number | null; account: MtprotoAccountKey }
  | { ok: false; code: string };

type PrivateInviteJoinResult =
  | { ok: true; account: MtprotoAccountKey; accountNumber: MtprotoAccountNumber; memberStatus: "member" | "already_member" }
  | { ok: false; code: string };

type MtprotoAccountConfig = {
  key: MtprotoAccountKey;
  session: string;
};

type MtChatLike = {
  id?: unknown;
  title?: unknown;
  participantsCount?: unknown;
};

export type PublicBotIdentityResult =
  | { ok: true; id: string; username: string; firstName: string; account: MtprotoAccountKey }
  | { ok: false; code: string; retryAfterSeconds?: number };

type MtImportUpdates = {
  chats?: unknown[];
};

const SESSION_ENV_BY_ACCOUNT: Record<MtprotoAccountKey, string> = {
  account_1: "TELEGRAM_MT_ACCOUNT_1_SESSION",
  account_2: "TELEGRAM_MT_ACCOUNT_2_SESSION",
};

export const MTPROTO_ACCOUNT_KEYS: MtprotoAccountKey[] = ["account_1", "account_2"];

const clientPromises: Partial<Record<MtprotoAccountKey, Promise<TelegramClient>>> = {};
const unhealthyAccounts=new Set<MtprotoAccountKey>();
const unhealthyAccountCodes = new Map<MtprotoAccountKey, string>();
const accountCooldownUntil = new Map<MtprotoAccountKey, number>();
const privateAccessCache = new Map<string, { expiresAt: number; accounts: MtprotoAccountKey[] }>();
const privateAccessFailureCache = new Map<string, { expiresAt: number; code: string }>();
const PRIVATE_ACCESS_CACHE_MS = 30 * 60 * 1000;
const PRIVATE_ACCESS_FAILURE_CACHE_MS = 5 * 60 * 1000;

function getSharedMtprotoConfig() {
  const apiId = Number.parseInt(process.env.TELEGRAM_API_ID || "", 10);
  const apiHash = process.env.TELEGRAM_API_HASH || "";

  if (!Number.isFinite(apiId) || apiId <= 0) {
    return { ok: false as const, code: "missing_api_id" };
  }
  if (!apiHash) {
    return { ok: false as const, code: "missing_api_hash" };
  }

  return { ok: true as const, apiId, apiHash };
}

function getMtprotoAccountPool() {
  const shared = getSharedMtprotoConfig();
  if (!shared.ok) return shared;

  const accounts = (Object.keys(SESSION_ENV_BY_ACCOUNT) as MtprotoAccountKey[])
    .map((key) => ({ key, session: process.env[SESSION_ENV_BY_ACCOUNT[key]] || "" }))
    .filter((account): account is MtprotoAccountConfig => Boolean(account.session));

  if (accounts.length === 0) {
    return { ok: false as const, code: "missing_account_sessions" };
  }

  return { ok: true as const, apiId: shared.apiId, apiHash: shared.apiHash, accounts };
}

async function getMtprotoClient(account: MtprotoAccountConfig, apiId: number, apiHash: string) {
  if (!clientPromises[account.key]) {
    clientPromises[account.key] = (async () => {
      const client = new TelegramClient(new StringSession(account.session), apiId, apiHash, {
        connectionRetries: 1,
        reconnectRetries: 1,
        requestRetries: 1,
        retryDelay: 500,
        floodSleepThreshold: 0,
      });
      await client.connect();

      if (!(await client.checkAuthorization())) {
        throw new Error("session_unauthorized");
      }

      // StringSession restores authorization, but a newly-created client does not
      // necessarily have the access hashes needed to resolve numeric private peers.
      // Hydrate the entity cache once per isolated account before any channel read.
      await client.getDialogs({ limit: 500 });

      return client;
    })().catch((error) => {
      delete clientPromises[account.key];
      throw error;
    });
  }

  return clientPromises[account.key] as Promise<TelegramClient>;
}

export function safeMtprotoErrorCode(error: unknown) {
  const structured = error as { code?: unknown } | null;
  if (structured?.code === 'rate_limited') return 'rate_limited';
  if (parseFloodWait(error)) return "rate_limited";
  const message = error instanceof Error ? error.message : String(error || "unknown_error");
  const upper = message.toUpperCase();

  if (message === "missing_api_id" || message === "missing_api_hash" || message === "missing_account_sessions") return message;
  if (message === "session_unauthorized") return "session_unauthorized";
  if (message === "verification_timeout") return message;
  if (upper.includes("AUTH_KEY_DUPLICATED")) return "auth_key_duplicated";
  if (upper.includes("AUTH_KEY_UNREGISTERED")) return "session_unauthorized";
  if (upper.includes("SESSION_REVOKED")) return "session_revoked";
  if (upper.includes("SESSION_PASSWORD_NEEDED")) return "session_password_needed";
  if (upper.includes("USER_DEACTIVATED")) return "account_deactivated";
  if (upper.includes("USER_NOT_PARTICIPANT")) return "not_channel_member";
  if (upper.includes("COULD NOT FIND THE INPUT ENTITY") || upper.includes("COULD NOT FIND INPUT ENTITY")) return "peer_entity_unavailable";
  if (upper.includes("CHANNEL_PRIVATE")) return "channel_private";
  if (upper.includes("INVITE_HASH_EMPTY")) return "invite_hash_empty";
  if (upper.includes("INVITE_HASH_EXPIRED")) return "invite_hash_expired";
  if (upper.includes("INVITE_HASH_INVALID")) return "invite_hash_invalid";
  if (upper.includes("USER_ALREADY_PARTICIPANT")) return "already_participant";
  if (upper.includes("CHAT_ADMIN_REQUIRED")) return "chat_admin_required";
  if (upper.includes("MESSAGE_ID_INVALID")) return "message_id_invalid";
  if (upper.includes("PEER_ID_INVALID")) return "peer_id_invalid";
  if (upper.includes("AUTH_KEY")) return "session_auth_error";
  if (upper.includes("FLOOD")) return "rate_limited";
  if (upper.includes("ENOTFOUND") || upper.includes("EAI_AGAIN") || upper.includes("ECONNREFUSED")) return "network_error";
  if (upper.includes("TIMEOUT") || upper.includes("ECONNRESET") || upper.includes("ETIMEDOUT")) return "network_error";
  if (upper.includes("RPC_CALL_FAIL")) return "telegram_rpc_error";

  return "mtproto_error";
}

export function classifyMtprotoError(error: unknown) {
  const structured = error as { retryAfterSeconds?: unknown } | null;
  const structuredRetry = Number(structured?.retryAfterSeconds);
  const retryAfterSeconds = (Number.isFinite(structuredRetry) && structuredRetry > 0
    ? structuredRetry
    : parseFloodWait(error)) || undefined;
  return { code: retryAfterSeconds ? "rate_limited" : safeMtprotoErrorCode(error), retryAfterSeconds };
}

function markMtprotoAccountFailure(
  account: MtprotoAccountKey,
  error: unknown,
  operation: MtprotoOperation,
  code = safeMtprotoErrorCode(error),
) {
  const floodWait = parseFloodWait(error);
  if (floodWait && floodWait > 0) {
    accountCooldownUntil.set(account, Date.now() + floodWait * 1000);
  }
  if (isMtprotoReauthenticationRequired(code)) {
    unhealthyAccounts.add(account);
    unhealthyAccountCodes.set(account, code);
    delete clientPromises[account];
  }
}

function mtprotoAccountAvailability(
  account: MtprotoAccountKey,
  operation: MtprotoOperation,
  now = Date.now(),
): MtprotoAccountAvailability {
  if (unhealthyAccounts.has(account)) {
    return { available: false, code: unhealthyAccountCodes.get(account) || "account_unhealthy" };
  }

  const cooldownUntil = accountCooldownUntil.get(account) || 0;
  if (cooldownUntil > now) {
    return {
      available: false,
      code: "rate_limited",
      retryAfterSeconds: Math.max(1, Math.ceil((cooldownUntil - now) / 1000)),
    };
  }
  if (cooldownUntil) accountCooldownUntil.delete(account);
  return { available: true };
}

type MtprotoSchedulerOptions = {
  availability: (account: MtprotoAccountKey, operation: MtprotoOperation) => MtprotoAccountAvailability;
  onFailure?: (account: MtprotoAccountKey, operation: MtprotoOperation, error: unknown) => void;
  minGapMs?: number;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
};

function availabilityError(availability: Exclude<MtprotoAccountAvailability, { available: true }>) {
  return Object.assign(new Error(availability.code), {
    code: availability.code,
    retryAfterSeconds: availability.retryAfterSeconds,
  });
}

export function createMtprotoAccountScheduler(options: MtprotoSchedulerOptions) {
  const requestChains = new Map<MtprotoAccountKey, Promise<void>>();
  const lastDispatchAt = new Map<MtprotoAccountKey, number>();
  const now = options.now || Date.now;
  const wait = options.wait || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const minGapMs = Math.max(0, options.minGapMs ?? 350);

  async function run<T>(
    account: MtprotoAccountKey,
    operation: MtprotoOperation,
    request: () => Promise<T>,
  ): Promise<T> {
    const predecessor = requestChains.get(account) || Promise.resolve();
    let release: () => void = () => undefined;
    const slot = new Promise<void>((resolve) => { release = resolve; });
    const tail = predecessor.catch(() => undefined).then(() => slot);
    requestChains.set(account, tail);

    await predecessor.catch(() => undefined);
    try {
      let availability = options.availability(account, operation);
      if (!availability.available) throw availabilityError(availability);

      const gapRemaining = Math.max(0, (lastDispatchAt.get(account) || 0) + minGapMs - now());
      if (gapRemaining > 0) await wait(gapRemaining);

      // An earlier queued request may have entered FLOOD_WAIT while this request waited.
      availability = options.availability(account, operation);
      if (!availability.available) throw availabilityError(availability);

      lastDispatchAt.set(account, now());
      try {
        return await request();
      } catch (error) {
        options.onFailure?.(account, operation, error);
        throw error;
      }
    } finally {
      release();
      if (requestChains.get(account) === tail) requestChains.delete(account);
    }
  }

  return { run };
}

const mtprotoAccountScheduler = createMtprotoAccountScheduler({
  availability: mtprotoAccountAvailability,
  minGapMs: Number(process.env.MTPROTO_ACCOUNT_MIN_GAP_MS || 350),
  onFailure: (account, operation, error) => {
    const classified = classifyMtprotoError(error);
    if (classified.code === 'rate_limited') {
      markMtprotoAccountFailure(account, error, operation, classified.code);
    }
  },
});

export function runMtprotoAccountRequest<T>(
  account: MtprotoAccountKey,
  operation: MtprotoOperation,
  request: () => Promise<T>,
) {
  return mtprotoAccountScheduler.run(account, operation, request);
}

export function isMtprotoReauthenticationRequired(code: string) {
  return [
    "auth_key_duplicated",
    "session_revoked",
    "session_password_needed",
    "session_unauthorized",
    "session_auth_error",
    "account_deactivated",
  ].includes(code);
}

export function mtprotoAccountNumber(account: MtprotoAccountKey): MtprotoAccountNumber {
  return account === "account_2" ? 2 : 1;
}

function mtprotoAccountKey(accountNumber: number): MtprotoAccountKey | null {
  return accountNumber === 1 ? "account_1" : accountNumber === 2 ? "account_2" : null;
}

function privateInviteHash(inviteLink: string) {
  const normalized = normalizePrivateInviteLink(inviteLink);
  const match = normalized?.match(/^https:\/\/t\.me\/(?:\+|joinchat\/)([A-Za-z0-9_-]+)$/);
  return match?.[1] || "";
}

export function getConfiguredMtprotoAccountNumbers(): MtprotoAccountNumber[] {
  return MTPROTO_ACCOUNT_KEYS
    .filter((key) => Boolean(process.env[SESSION_ENV_BY_ACCOUNT[key]]))
    .map(mtprotoAccountNumber);
}

export function getMtprotoAccountAvailability(accountNumber: MtprotoAccountNumber, operation: MtprotoOperation = "membership") {
  const accountKey = mtprotoAccountKey(accountNumber);
  if (!accountKey) return { available: false as const, code: "invalid_account" };
  return mtprotoAccountAvailability(accountKey, operation);
}

export function getMtprotoViewPoolAvailability(now = Date.now()) {
  const configuredAccounts = getConfiguredMtprotoAccountNumbers();
  const accounts = configuredAccounts.map((account) => ({
    account,
    ...getMtprotoAccountAvailability(account, "view_read"),
  }));
  const availableAccounts = accounts.filter((account) => account.available).map((account) => account.account);
  const unavailableAccounts = accounts.filter((account) => !account.available).map((account) => ({
    account: account.account,
    code: account.available ? "available" : account.code,
    retryAfterSeconds: account.available ? undefined : account.retryAfterSeconds,
  }));
  const retryAfterSeconds = unavailableAccounts
    .map((account) => Number(account.retryAfterSeconds || 0))
    .filter((seconds) => seconds > 0)
    .sort((left, right) => left - right)[0];
  const unavailableCodes = unavailableAccounts.map((account) => account.code);
  const code = configuredAccounts.length === 0
    ? "missing_account_sessions"
    : availableAccounts.length > 0
      ? null
      : unavailableCodes.every((value) => value === "rate_limited")
        ? "rate_limited"
        : unavailableCodes.every(isMtprotoReauthenticationRequired)
          ? "all_accounts_unhealthy"
          : "all_accounts_unavailable";
  return {
    checkedAt: now,
    configuredAccounts,
    availableAccounts,
    unavailableAccounts,
    retryAfterSeconds,
    code,
  };
}

export function getTrackingAccountUsernames() {
  return [
    { account: 1 as const, username: String(process.env.TELEGRAM_MT_ACCOUNT_1_USERNAME || "EarningPandaAdmin").replace(/^@/, "").trim() },
    { account: 2 as const, username: String(process.env.TELEGRAM_MT_ACCOUNT_2_USERNAME || "qthfdssv").replace(/^@/, "").trim() },
  ].filter((item) => item.username);
}

/** Resolve a public bot as a Telegram user entity, never through the platform bot's getChat. */
export async function resolvePublicBotIdentity(usernameInput: string): Promise<PublicBotIdentityResult> {
  const username = String(usernameInput || "").trim().replace(/^@/, "");
  if (!/^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(username)) return { ok: false, code: "invalid_username" };
  const pool = getMtprotoAccountPool();
  if (!pool.ok) return { ok: false, code: pool.code };
  let lastCode = "all_accounts_unavailable";
  let retryAfterSeconds: number | undefined;
  for (const account of pool.accounts) {
    const availability = mtprotoAccountAvailability(account.key, "identity_lookup");
    if (!availability.available) { lastCode = availability.code; retryAfterSeconds ||= availability.retryAfterSeconds; continue; }
    try {
      const entity = await Promise.race([
        runMtprotoAccountRequest(account.key, "identity_lookup", async () => (await getMtprotoClient(account, pool.apiId, pool.apiHash)).getEntity(username)),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("verification_timeout")), 8_000)),
      ]);
      const candidate = entity as { id?: unknown; username?: unknown; firstName?: unknown; bot?: unknown };
      if (candidate.bot !== true) return { ok: false, code: "not_a_bot" };
      const id = String(candidate.id ?? "");
      if (!/^\d{1,20}$/.test(id)) return { ok: false, code: "invalid_entity" };
      const canonicalUsername = String(candidate.username || "").replace(/^@/, "");
      if (!canonicalUsername) return { ok: false, code: "username_not_occupied" };
      return { ok: true, id, username: canonicalUsername, firstName: String(candidate.firstName || "").trim(), account: account.key };
    } catch (error) {
      const classified = classifyMtprotoError(error);
      lastCode = classified.code;
      retryAfterSeconds ||= classified.retryAfterSeconds;
      markMtprotoAccountFailure(account.key, error, "identity_lookup", classified.code);
      if (isMtprotoReauthenticationRequired(classified.code)) continue;
      if (["peer_entity_unavailable", "peer_id_invalid"].includes(classified.code)) return { ok: false, code: "username_not_occupied" };
    }
  }
  return { ok: false, code: lastCode, retryAfterSeconds };
}

function telegramChannelChatId(chat: unknown) {
  const candidate = chat as MtChatLike | null;
  if (!candidate) return "";
  const rawId = String(candidate.id || "").replace(/^-/, "");
  if (!rawId) return "";
  return rawId.startsWith("100") ? `-${rawId}` : `-100${rawId}`;
}

function chatTitle(chat: unknown) {
  const candidate = chat as MtChatLike | null;
  return String(candidate?.title || "").trim();
}

function participantsCount(chat: unknown) {
  const candidate = chat as MtChatLike | null;
  const count = Number(candidate?.participantsCount);
  return Number.isFinite(count) ? count : null;
}

async function getViewsWithAccount(
  account: MtprotoAccountConfig,
  apiId: number,
  apiHash: string,
  chatId: string | number,
  messageId: number
) {
  const client = await getMtprotoClient(account, apiId, apiHash);
  const peer = await client.getInputEntity(typeof chatId === "number" ? chatId : String(chatId));
  const result = await client.invoke(
    new Api.messages.GetMessagesViews({
      peer,
      id: [messageId],
      increment: false,
    })
  );

  return Number(result.views[0]?.views || 0);
}

export function orderMtprotoViewAccounts(
  accounts: MtprotoAccountKey[],
  rotationSeed = 0,
  preferredAccount?: number | null,
) {
  if (accounts.length < 2) return [...accounts];
  const offset = Math.abs(rotationSeed) % accounts.length;
  const rotated = [...accounts.slice(offset), ...accounts.slice(0, offset)];
  const preferredKey = preferredAccount ? mtprotoAccountKey(preferredAccount) : null;
  // Stored private assignments are already distributed across the pool and remain
  // the first safe read. Public reads have no preference and retain seed balancing.
  if (preferredKey && rotated.includes(preferredKey)) {
    return [preferredKey, ...rotated.filter((account) => account !== preferredKey)];
  }
  return rotated;
}

const PRIVATE_ACCESS_FAILURE_CODES = new Set([
  "channel_private",
  "chat_admin_required",
  "not_channel_member",
  "peer_entity_unavailable",
  "peer_id_invalid",
]);

function minimumRetryAfter(current: number | undefined, candidate: number | undefined) {
  if (!candidate) return current;
  return current ? Math.min(current, candidate) : candidate;
}

function emptyViewDiagnostics(): MtprotoViewDiagnostics {
  return {
    verifiedAccounts: [],
    attemptedAccounts: [],
    cooldownAccounts: [],
    requestsAttempted: 0,
    actualFailures: 0,
  };
}

export async function runMtprotoViewAttempts(input: {
  accountKeys: MtprotoAccountKey[];
  rotationSeed?: number;
  preferredAccount?: number | null;
  privateChannel?: boolean;
  verifiedAccounts?: MtprotoAccountKey[];
  availability: (account: MtprotoAccountKey) => MtprotoAccountAvailability;
  attempt: (account: MtprotoAccountKey) => Promise<number>;
  onFailure?: (account: MtprotoAccountKey, error: unknown, code: string) => void;
}): Promise<PrivatePostViewResult> {
  const orderedKeys = orderMtprotoViewAccounts(input.accountKeys, input.rotationSeed || 0, input.preferredAccount);
  const attemptedAccounts: MtprotoAccountNumber[] = [];
  const cooldownAccounts: MtprotoAccountNumber[] = [];
  const verifiedKeys = new Set(input.verifiedAccounts || []);
  const failures: Array<{ account: MtprotoAccountKey; code: string; retryAfterSeconds?: number }> = [];
  const actualFailureCodes: string[] = [];
  let actualFailures = 0;
  let retryAfterSeconds: number | undefined;

  for (const account of orderedKeys) {
    const availability = input.availability(account);
    if (!availability.available) {
      failures.push({ account, code: availability.code, retryAfterSeconds: availability.retryAfterSeconds });
      if (availability.code === "rate_limited") {
        cooldownAccounts.push(mtprotoAccountNumber(account));
        retryAfterSeconds = minimumRetryAfter(retryAfterSeconds, availability.retryAfterSeconds);
      }
      continue;
    }

    attemptedAccounts.push(mtprotoAccountNumber(account));
    try {
      const views = await input.attempt(account);
      if (input.privateChannel) verifiedKeys.add(account);
      return {
        ok: true,
        views,
        account,
        verifiedAccounts: [...verifiedKeys].map(mtprotoAccountNumber),
        attemptedAccounts,
        cooldownAccounts,
        requestsAttempted: attemptedAccounts.length,
        actualFailures,
        retryAfterSeconds,
      };
    } catch (error) {
      actualFailures += 1;
      const classified = classifyMtprotoError(error);
      actualFailureCodes.push(classified.code);
      failures.push({ account, ...classified });
      retryAfterSeconds = minimumRetryAfter(retryAfterSeconds, classified.retryAfterSeconds);
      input.onFailure?.(account, error, classified.code);
      if (classified.code === "message_id_invalid") break;
    }
  }

  const diagnostics: MtprotoViewDiagnostics = {
    verifiedAccounts: [...verifiedKeys].map(mtprotoAccountNumber),
    attemptedAccounts,
    cooldownAccounts,
    requestsAttempted: attemptedAccounts.length,
    actualFailures,
    retryAfterSeconds,
  };
  const codes = failures.map((failure) => failure.code);

  // A skipped account in an existing cooldown is not an attempted Telegram
  // failure. Do not let that skip hide the precise failure from an account that
  // was actually tried (for example peer_entity_unavailable).
  if (actualFailureCodes.includes("rate_limited") || (actualFailures === 0 && codes.includes("rate_limited"))) {
    return { ok: false, code: "rate_limited", ...diagnostics };
  }
  if (codes.length > 0 && codes.every(isMtprotoReauthenticationRequired)) {
    return { ok: false, code: "all_accounts_unhealthy", ...diagnostics };
  }
  if (input.privateChannel && actualFailureCodes.length > 0 && actualFailureCodes.every((code) => PRIVATE_ACCESS_FAILURE_CODES.has(code))) {
    return { ok: false, code: "no_verified_private_member", ...diagnostics };
  }
  if (actualFailureCodes.includes("message_id_invalid")) return { ok: false, code: "message_id_invalid", ...diagnostics };
  if (actualFailureCodes.length > 0 && actualFailureCodes.every((code) => code === actualFailureCodes[0])) {
    return { ok: false, code: actualFailureCodes[0], ...diagnostics };
  }
  if (attemptedAccounts.length > 0) return { ok: false, code: "all_accounts_failed", ...diagnostics };
  return { ok: false, code: codes[0] || "all_accounts_failed", ...diagnostics };
}

function privateAccessCacheKey(chatId: string | number, account: MtprotoAccountKey) {
  return `${String(chatId)}:${account}`;
}

function cachedPrivateAccessAccounts(chatId: string | number) {
  const cacheKey = String(chatId);
  const cached = privateAccessCache.get(cacheKey);
  if (!cached || cached.expiresAt <= Date.now()) {
    if (cached) privateAccessCache.delete(cacheKey);
    return [] as MtprotoAccountKey[];
  }
  return cached.accounts;
}

function rememberPrivateAccess(chatId: string | number, account: MtprotoAccountKey) {
  const accounts = new Set(cachedPrivateAccessAccounts(chatId));
  accounts.add(account);
  privateAccessCache.set(String(chatId), { expiresAt: Date.now() + PRIVATE_ACCESS_CACHE_MS, accounts: [...accounts] });
  privateAccessFailureCache.delete(privateAccessCacheKey(chatId, account));
}

function rememberPrivateAccessFailure(chatId: string | number, account: MtprotoAccountKey, code: string) {
  if (!PRIVATE_ACCESS_FAILURE_CODES.has(code)) return;
  privateAccessFailureCache.set(privateAccessCacheKey(chatId, account), {
    expiresAt: Date.now() + PRIVATE_ACCESS_FAILURE_CACHE_MS,
    code,
  });
}

function privateViewAvailability(chatId: string | number, account: MtprotoAccountKey): MtprotoAccountAvailability {
  const viewAvailability = mtprotoAccountAvailability(account, "view_read");
  if (!viewAvailability.available) return viewAvailability;
  const key = privateAccessCacheKey(chatId, account);
  const cachedFailure = privateAccessFailureCache.get(key);
  if (cachedFailure && cachedFailure.expiresAt > Date.now()) {
    return { available: false, code: cachedFailure.code };
  }
  if (cachedFailure) privateAccessFailureCache.delete(key);
  return { available: true };
}

export async function getMtprotoChannelMemberCount(chatId: string | number, preferredAccount?: number | null, onHealth?:(account:MtprotoAccountKey,status:"healthy"|"unhealthy",code?:string)=>Promise<void>): Promise<ChannelMemberCountResult> {
  const pool = getMtprotoAccountPool();
  if (!pool.ok) return { ok: false, code: pool.code };
  const preferredKey = preferredAccount ? mtprotoAccountKey(preferredAccount) : null;
  const ordered = preferredKey ? [...pool.accounts.filter(a=>a.key===preferredKey),...pool.accounts.filter(a=>a.key!==preferredKey)] : pool.accounts;
  const accounts=ordered.filter(a=>mtprotoAccountAvailability(a.key, "membership").available);
  return resolveMemberCountAcrossAccounts(accounts,unhealthyAccounts,async(account)=>Promise.race([
      runMtprotoAccountRequest(account.key, 'membership', async()=>{ const client=await getMtprotoClient(account,pool.apiId,pool.apiHash); const full=await client.invoke(new Api.channels.GetFullChannel({channel:await client.getInputEntity(chatId)})); return (full.fullChat as unknown as {participantsCount?:unknown}).participantsCount; }),
      new Promise<unknown>((_,reject)=>setTimeout(()=>reject(new Error("verification_timeout")),10_000)),
    ]),onHealth);
}

export async function resolveMemberCountAcrossAccounts<T extends {key:MtprotoAccountKey}>(accounts:T[],unhealthy:Set<MtprotoAccountKey>,attempt:(account:T)=>Promise<unknown>,onHealth?:(account:MtprotoAccountKey,status:"healthy"|"unhealthy",code?:string)=>Promise<void>):Promise<ChannelMemberCountResult>{let lastFailure="all_accounts_failed",lastAccount:MtprotoAccountKey|undefined,retryAfterSeconds:number|undefined;for(const account of accounts){if(unhealthy.has(account.key))continue;try{const validated=authoritativeMemberCount(await attempt(account));if(!validated.ok)throw new Error(validated.code);await onHealth?.(account.key,"healthy");return{ok:true,count:validated.count,account:account.key};}catch(error){const classified=classifyMtprotoError(error);lastFailure=error instanceof Error&&error.message==="member_count_unavailable"?"member_count_unavailable":classified.code;lastAccount=account.key;retryAfterSeconds=minimumRetryAfter(retryAfterSeconds,classified.retryAfterSeconds);markMtprotoAccountFailure(account.key,error,"membership",lastFailure);if(isMtprotoReauthenticationRequired(lastFailure)){unhealthy.add(account.key);delete clientPromises[account.key];await onHealth?.(account.key,"unhealthy",lastFailure);}}}return{ok:false,code:lastFailure,account:lastAccount,retryAfterSeconds};}

async function resolveInviteWithAccount(
  account: MtprotoAccountConfig,
  apiId: number,
  apiHash: string,
  inviteLink: string
): Promise<PrivateInviteResolveResult> {
  const hash = privateInviteHash(inviteLink);
  if (!hash) return { ok: false, code: "invalid_invite_link" };

  const client = await getMtprotoClient(account, apiId, apiHash);
  const checked = await client.invoke(new Api.messages.CheckChatInvite({ hash }));

  if (checked instanceof Api.ChatInviteAlready || checked instanceof Api.ChatInvitePeek) {
    const chat = checked.chat;
    const chatId = telegramChannelChatId(chat);
    if (!chatId) return { ok: false, code: "missing_chat_id" };

    return {
      ok: true,
      chatId,
      title: chatTitle(chat),
      participantsCount: participantsCount(chat),
      account: account.key,
    };
  }

  if (checked instanceof Api.ChatInvite && checked.requestNeeded) {
    return { ok: false, code: "join_request_required" };
  }

  const imported = await client.invoke(new Api.messages.ImportChatInvite({ hash })) as MtImportUpdates;
  const chat = (imported.chats || []).find((candidate) => candidate instanceof Api.Channel || candidate instanceof Api.Chat);
  const chatId = telegramChannelChatId(chat);

  if (!chatId) return { ok: false, code: "missing_chat_id" };

  return {
    ok: true,
    chatId,
    title: chatTitle(chat),
    participantsCount: participantsCount(chat),
    account: account.key,
  };
}

export async function resolvePrivateInviteLink(inviteLink: string): Promise<PrivateInviteResolveResult> {
  const pool = getMtprotoAccountPool();
  if (!pool.ok) return { ok: false, code: pool.code };
  let failureCode = "all_accounts_failed";
  for (const account of pool.accounts) {
    const availability = mtprotoAccountAvailability(account.key, "membership");
    if (!availability.available) { failureCode = availability.code; continue; }
    try {
      return await Promise.race([
        runMtprotoAccountRequest(account.key, 'membership', () => resolveInviteWithAccount(account, pool.apiId, pool.apiHash, inviteLink)),
        new Promise<PrivateInviteResolveResult>((_, reject) => {
          setTimeout(() => reject(new Error("verification_timeout")), 12_000);
        }),
      ]);
    } catch (error) {
      const code = safeMtprotoErrorCode(error);
      failureCode = code;
      if (code === "already_participant") {
        try {
          const chat = await runMtprotoAccountRequest(account.key, 'membership', async () => {
            const client = await getMtprotoClient(account, pool.apiId, pool.apiHash);
            return client.getEntity(inviteLink);
          });
          const chatId = telegramChannelChatId(chat);
          if (chatId) {
            return {
              ok: true,
              chatId,
              title: chatTitle(chat),
              participantsCount: participantsCount(chat),
              account: account.key,
            };
          }
        } catch (retryError) {
          console.error(`Private invite MTProto ${account.key} retry failed: ${safeMtprotoErrorCode(retryError)}`);
        }
      }
      markMtprotoAccountFailure(account.key, error, "membership", code);
      console.error(`Private invite MTProto ${account.key} failed: ${code}`);
    }
  }

  return { ok: false, code: failureCode };
}

export async function joinPrivateInviteWithAccount(
  accountNumber: MtprotoAccountNumber,
  inviteLink: string
): Promise<PrivateInviteJoinResult> {
  const accountKey = mtprotoAccountKey(accountNumber);
  if (!accountKey) return { ok: false, code: "invalid_account" };

  const availability = mtprotoAccountAvailability(accountKey, "membership");
  if (!availability.available) return { ok: false, code: availability.code };

  const pool = getMtprotoAccountPool();
  if (!pool.ok) return { ok: false, code: pool.code };

  const account = pool.accounts.find((candidate) => candidate.key === accountKey);
  if (!account) return { ok: false, code: "missing_account_session" };

  const hash = privateInviteHash(inviteLink);
  if (!hash) return { ok: false, code: "invalid_invite_link" };

  try {
    await runMtprotoAccountRequest(account.key, 'membership', async () => {
      const client = await getMtprotoClient(account, pool.apiId, pool.apiHash);
      await client.invoke(new Api.messages.ImportChatInvite({ hash }));
    });
    accountCooldownUntil.delete(account.key);
    return { ok: true, account: account.key, accountNumber, memberStatus: "member" };
  } catch (error) {
    const code = safeMtprotoErrorCode(error);
    if (code === "already_participant") {
      accountCooldownUntil.delete(account.key);
      return { ok: true, account: account.key, accountNumber, memberStatus: "already_member" };
    }
    markMtprotoAccountFailure(account.key, error, "membership", code);
    console.error(`Private tracking join MTProto ${account.key} failed: ${code}`);
    return { ok: false, code };
  }
}

export async function getPrivatePostViews(
  chatId: string | number,
  messageId: string | number,
  options: { preferredAccount?: number | null; rotationSeed?: number; requirePreferredAccount?: boolean; verifyPrivateMembership?: boolean } = {}
): Promise<PrivatePostViewResult> {
  const parsedMessageId = Number.parseInt(String(messageId), 10);
  if (!chatId) return { ok: false, code: "missing_chat_id", ...emptyViewDiagnostics() };
  if (!Number.isFinite(parsedMessageId) || parsedMessageId <= 0) return { ok: false, code: "missing_message_id", ...emptyViewDiagnostics() };

  const pool = getMtprotoAccountPool();
  if (!pool.ok) return { ok: false, code: pool.code, ...emptyViewDiagnostics() };

  const preferredKey = options.preferredAccount ? mtprotoAccountKey(options.preferredAccount) : null;
  if (options.requirePreferredAccount && !preferredKey) {
    return { ok: false, code: "tracking_account_missing", ...emptyViewDiagnostics() };
  }
  const candidateKeys = options.requirePreferredAccount && preferredKey
    ? [preferredKey]
    : pool.accounts.map((account) => account.key);
  const privateChannel = Boolean(options.verifyPrivateMembership);

  const result = await runMtprotoViewAttempts({
    accountKeys: candidateKeys,
    rotationSeed: options.rotationSeed,
    preferredAccount: options.preferredAccount,
    privateChannel,
    verifiedAccounts: privateChannel ? cachedPrivateAccessAccounts(chatId) : [],
    availability: (accountKey) => privateChannel
      ? privateViewAvailability(chatId, accountKey)
      : mtprotoAccountAvailability(accountKey, "view_read"),
    attempt: async (accountKey) => {
      const account = pool.accounts.find((candidate) => candidate.key === accountKey);
      if (!account) throw new Error("missing_account_session");
      return Promise.race([
        runMtprotoAccountRequest(account.key, 'view_read', () => getViewsWithAccount(account, pool.apiId, pool.apiHash, chatId, parsedMessageId)),
        new Promise<number>((_, reject) => setTimeout(() => reject(new Error("verification_timeout")), 10_000)),
      ]);
    },
    onFailure: (accountKey, error, code) => {
      markMtprotoAccountFailure(accountKey, error, "view_read", code);
      if (privateChannel) rememberPrivateAccessFailure(chatId, accountKey, code);
      console.error(`Private views MTProto ${accountKey} failed: ${code}`);
    },
  });

  if (result.ok && privateChannel) rememberPrivateAccess(chatId, result.account);
  return result;
}
