import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";

type MtprotoAccountKey = "account_1" | "account_2";

type PrivatePostViewResult =
  | { ok: true; views: number; account: MtprotoAccountKey }
  | { ok: false; code: string };

type PrivateInviteResolveResult =
  | { ok: true; chatId: string; title: string; participantsCount: number | null; account: MtprotoAccountKey }
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
        connectionRetries: 3,
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

function privateInviteHash(inviteLink: string) {
  const trimmed = inviteLink.trim();
  const match = trimmed.match(/^https:\/\/t\.me\/(?:\+|joinchat\/)([A-Za-z0-9_-]+)$/);
  return match?.[1] || "";
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
      return await resolveInviteWithAccount(account, pool.apiId, pool.apiHash, inviteLink);
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

export async function getPrivatePostViews(chatId: string | number, messageId: string | number): Promise<PrivatePostViewResult> {
  const parsedMessageId = Number.parseInt(String(messageId), 10);
  if (!chatId) return { ok: false, code: "missing_chat_id" };
  if (!Number.isFinite(parsedMessageId) || parsedMessageId <= 0) return { ok: false, code: "missing_message_id" };

  const pool = getMtprotoAccountPool();
  if (!pool.ok) return { ok: false, code: pool.code };

  for (const account of pool.accounts) {
    try {
      const views = await getViewsWithAccount(account, pool.apiId, pool.apiHash, chatId, parsedMessageId);
      return { ok: true, views, account: account.key };
    } catch (error) {
      const code = safeMtprotoErrorCode(error);
      console.error(`Private views MTProto ${account.key} failed: ${code}`);
    }
  }

  return { ok: false, code: "all_accounts_failed" };
}
