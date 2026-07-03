import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { normalizePrivateInviteLink } from "@/lib/telegramChannelInput";

export type MtprotoAccountKey = "account_1" | "account_2";
export type MtprotoAccountNumber = 1 | 2;

type PrivatePostViewResult =
  | { ok: true; views: number; account: MtprotoAccountKey }
  | { ok: false; code: string };

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

type MtImportUpdates = {
  chats?: unknown[];
};

const SESSION_ENV_BY_ACCOUNT: Record<MtprotoAccountKey, string> = {
  account_1: "TELEGRAM_MT_ACCOUNT_1_SESSION",
  account_2: "TELEGRAM_MT_ACCOUNT_2_SESSION",
};

export const MTPROTO_ACCOUNT_KEYS: MtprotoAccountKey[] = ["account_1", "account_2"];

const clientPromises: Partial<Record<MtprotoAccountKey, Promise<TelegramClient>>> = {};

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

      return client;
    })().catch((error) => {
      delete clientPromises[account.key];
      throw error;
    });
  }

  return clientPromises[account.key] as Promise<TelegramClient>;
}

function safeMtprotoErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "unknown_error");
  const upper = message.toUpperCase();

  if (message === "missing_api_id" || message === "missing_api_hash" || message === "missing_account_sessions") return message;
  if (message === "session_unauthorized") return message;
  if (message === "verification_timeout") return message;
  if (upper.includes("CHANNEL_PRIVATE")) return "channel_private";
  if (upper.includes("INVITE_HASH_EMPTY")) return "invite_hash_empty";
  if (upper.includes("INVITE_HASH_EXPIRED")) return "invite_hash_expired";
  if (upper.includes("INVITE_HASH_INVALID")) return "invite_hash_invalid";
  if (upper.includes("USER_ALREADY_PARTICIPANT")) return "already_participant";
  if (upper.includes("CHAT_ADMIN_REQUIRED")) return "chat_admin_required";
  if (upper.includes("MESSAGE_ID_INVALID")) return "message_id_invalid";
  if (upper.includes("PEER_ID_INVALID")) return "peer_id_invalid";
  if (upper.includes("AUTH_KEY") || upper.includes("SESSION_PASSWORD_NEEDED")) return "session_auth_error";
  if (upper.includes("FLOOD")) return "rate_limited";
  if (upper.includes("TIMEOUT") || upper.includes("ECONNRESET") || upper.includes("ETIMEDOUT")) return "network_error";

  return "mtproto_error";
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

export function getTrackingAccountUsernames() {
  return [
    { account: 1 as const, username: String(process.env.TELEGRAM_MT_ACCOUNT_1_USERNAME || "EarningPandaAdmin").replace(/^@/, "").trim() },
    { account: 2 as const, username: String(process.env.TELEGRAM_MT_ACCOUNT_2_USERNAME || "qthfdssv").replace(/^@/, "").trim() },
  ].filter((item) => item.username);
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

  for (const account of pool.accounts) {
    try {
      return await Promise.race([
        resolveInviteWithAccount(account, pool.apiId, pool.apiHash, inviteLink),
        new Promise<PrivateInviteResolveResult>((_, reject) => {
          setTimeout(() => reject(new Error("verification_timeout")), 12_000);
        }),
      ]);
    } catch (error) {
      const code = safeMtprotoErrorCode(error);
      if (code === "already_participant") {
        try {
          const client = await getMtprotoClient(account, pool.apiId, pool.apiHash);
          const chat = await client.getEntity(inviteLink);
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
      console.error(`Private invite MTProto ${account.key} failed: ${code}`);
    }
  }

  return { ok: false, code: "all_accounts_failed" };
}

export async function joinPrivateInviteWithAccount(
  accountNumber: MtprotoAccountNumber,
  inviteLink: string
): Promise<PrivateInviteJoinResult> {
  const accountKey = mtprotoAccountKey(accountNumber);
  if (!accountKey) return { ok: false, code: "invalid_account" };

  const pool = getMtprotoAccountPool();
  if (!pool.ok) return { ok: false, code: pool.code };

  const account = pool.accounts.find((candidate) => candidate.key === accountKey);
  if (!account) return { ok: false, code: "missing_account_session" };

  const hash = privateInviteHash(inviteLink);
  if (!hash) return { ok: false, code: "invalid_invite_link" };

  try {
    const client = await getMtprotoClient(account, pool.apiId, pool.apiHash);
    await client.invoke(new Api.messages.ImportChatInvite({ hash }));
    return { ok: true, account: account.key, accountNumber, memberStatus: "member" };
  } catch (error) {
    const code = safeMtprotoErrorCode(error);
    if (code === "already_participant") {
      return { ok: true, account: account.key, accountNumber, memberStatus: "already_member" };
    }
    console.error(`Private tracking join MTProto ${account.key} failed: ${code}`);
    return { ok: false, code };
  }
}

export async function getPrivatePostViews(
  chatId: string | number,
  messageId: string | number,
  options: { preferredAccount?: number | null; rotationSeed?: number } = {}
): Promise<PrivatePostViewResult> {
  const parsedMessageId = Number.parseInt(String(messageId), 10);
  if (!chatId) return { ok: false, code: "missing_chat_id" };
  if (!Number.isFinite(parsedMessageId) || parsedMessageId <= 0) return { ok: false, code: "missing_message_id" };

  const pool = getMtprotoAccountPool();
  if (!pool.ok) return { ok: false, code: pool.code };

  const preferredKey = options.preferredAccount ? mtprotoAccountKey(options.preferredAccount) : null;
  const offset = Math.abs(options.rotationSeed || 0) % pool.accounts.length;
  const rotated = [...pool.accounts.slice(offset), ...pool.accounts.slice(0, offset)];
  const accounts = preferredKey
    ? [...rotated.filter((account) => account.key === preferredKey), ...rotated.filter((account) => account.key !== preferredKey)]
    : rotated;

  let lastFailure = "all_accounts_failed";
  for (const account of accounts) {
    try {
      const views = await Promise.race([
        getViewsWithAccount(account, pool.apiId, pool.apiHash, chatId, parsedMessageId),
        new Promise<number>((_, reject) => setTimeout(() => reject(new Error("verification_timeout")), 10_000)),
      ]);
      return { ok: true, views, account: account.key };
    } catch (error) {
      const code = safeMtprotoErrorCode(error);
      lastFailure = code;
      console.error(`Private views MTProto ${account.key} failed: ${code}`);
    }
  }

  return { ok: false, code: lastFailure };
}
