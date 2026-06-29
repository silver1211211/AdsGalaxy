import pool from "@/lib/db";
import type { ChannelPrivacySchema } from "@/lib/channelPrivacy";
import {
  getConfiguredMtprotoAccountNumbers,
  getTrackingAccountUsernames,
  joinPrivateInviteWithAccount,
  type MtprotoAccountNumber,
} from "@/lib/telegramMtproto";

type TelegramResponse<T = any> = {
  ok: boolean;
  result?: T;
  description?: string;
};

type BotMember = {
  status?: string;
  can_invite_users?: boolean;
};

type InviteLink = {
  invite_link?: string;
};

export type TrackingOnboardingResult =
  | { status: "not_required"; manual_usernames: ReturnType<typeof getTrackingAccountUsernames> }
  | { status: "active"; tracking_account: MtprotoAccountNumber; member_status: string; manual_usernames: ReturnType<typeof getTrackingAccountUsernames> }
  | { status: "pending_manual"; reason: string; manual_usernames: ReturnType<typeof getTrackingAccountUsernames> };

function safeReason(value: unknown) {
  return String(value || "unknown")
    .replace(/https:\/\/t\.me\/(?:\+|joinchat\/)[A-Za-z0-9_-]+/g, "[invite_link]")
    .slice(0, 255);
}

function hasTrackingColumns(schema: ChannelPrivacySchema) {
  return schema.hasTrackingAccountStatus
    && schema.hasTrackingAccount
    && schema.hasTrackingAccountMemberStatus
    && schema.hasTrackingAccountAssignedAt
    && schema.hasTrackingAccountLastSuccessAt
    && schema.hasTrackingAccountLastFailureAt
    && schema.hasTrackingAccountFailureReason;
}

async function telegram<T = any>(method: string, body: Record<string, unknown>): Promise<TelegramResponse<T>> {
  const token = process.env.BOT_TOKEN;
  if (!token) return { ok: false, description: "bot_token_missing" };

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.json();
  } catch {
    return { ok: false, description: "telegram_network_error" };
  }
}

async function botCanInvite(chatId: string | number) {
  const me = await telegram<{ id: number }>("getMe", {});
  if (!me.ok || !me.result?.id) return { ok: false as const, reason: safeReason(me.description || "bot_identity_unavailable") };

  const member = await telegram<BotMember>("getChatMember", { chat_id: chatId, user_id: me.result.id });
  if (!member.ok) return { ok: false as const, reason: safeReason(member.description || "bot_member_check_failed") };

  const status = member.result?.status;
  const isAdmin = status === "administrator" || status === "creator";
  const canInvite = status === "creator" || member.result?.can_invite_users === true;

  if (!isAdmin) return { ok: false as const, reason: "bot_not_admin" };
  if (!canInvite) return { ok: false as const, reason: "bot_invite_permission_missing" };

  return { ok: true as const };
}

async function markActive(
  channelId: number | string,
  account: MtprotoAccountNumber,
  memberStatus: string,
  schema: ChannelPrivacySchema
) {
  if (!hasTrackingColumns(schema)) return;

  await pool.query(
    `UPDATE channels
     SET tracking_account_status = 'active',
         tracking_account = ?,
         tracking_account_member_status = ?,
         tracking_account_assigned_at = COALESCE(tracking_account_assigned_at, NOW()),
         tracking_account_last_success_at = NOW(),
         tracking_account_last_failure_at = NULL,
         tracking_account_failure_reason = NULL
     WHERE id = ?`,
    [account, memberStatus, channelId]
  );
}

async function markPendingManual(channelId: number | string, reason: string, schema: ChannelPrivacySchema) {
  if (!hasTrackingColumns(schema)) return;

  const viewTrackingUpdate = schema.hasViewTrackingStatus ? ", view_tracking_status = 'limited'" : "";
  await pool.query(
    `UPDATE channels
     SET tracking_account_status = 'pending_manual',
         tracking_account = NULL,
         tracking_account_member_status = NULL,
         tracking_account_last_failure_at = NOW(),
         tracking_account_failure_reason = ?
         ${viewTrackingUpdate}
     WHERE id = ?`,
    [safeReason(reason), channelId]
  );
}

export async function clearPrivateTrackingAssignment(channelId: number | string, schema: ChannelPrivacySchema) {
  if (!hasTrackingColumns(schema)) return;

  await pool.query(
    `UPDATE channels
     SET tracking_account_status = 'removed',
         tracking_account = NULL,
         tracking_account_member_status = NULL,
         tracking_account_failure_reason = NULL
     WHERE id = ?`,
    [channelId]
  );
}

function chooseAccountOrder(configuredAccounts: MtprotoAccountNumber[]) {
  return ([1, 2] as MtprotoAccountNumber[]).filter((account) => configuredAccounts.includes(account));
}

export async function onboardPrivateChannelTracking(input: {
  channelId: number | string;
  chatId: string | number;
  channelType: "public" | "private";
  schema: ChannelPrivacySchema;
}): Promise<TrackingOnboardingResult> {
  const manual_usernames = getTrackingAccountUsernames();

  if (input.channelType !== "private") {
    if (hasTrackingColumns(input.schema)) {
      await pool.query(
        `UPDATE channels
         SET tracking_account_status = 'not_required',
             tracking_account = NULL,
             tracking_account_member_status = NULL,
             tracking_account_failure_reason = NULL
             ${input.schema.hasViewTrackingStatus ? ", view_tracking_status = 'available'" : ""}
         WHERE id = ?`,
        [input.channelId]
      );
    }
    return { status: "not_required", manual_usernames };
  }

  if (!hasTrackingColumns(input.schema)) {
    return { status: "pending_manual", reason: "tracking_columns_missing", manual_usernames };
  }

  const invitePermission = await botCanInvite(input.chatId);
  if (!invitePermission.ok) {
    await markPendingManual(input.channelId, invitePermission.reason, input.schema);
    return { status: "pending_manual", reason: invitePermission.reason, manual_usernames };
  }

  const configuredAccounts = getConfiguredMtprotoAccountNumbers();
  if (configuredAccounts.length === 0) {
    await markPendingManual(input.channelId, "missing_account_sessions", input.schema);
    return { status: "pending_manual", reason: "missing_account_sessions", manual_usernames };
  }

  const accountOrder = await chooseAccountOrder(configuredAccounts);
  const errors: string[] = [];

  for (const account of accountOrder) {
    let createdInvite: string | null = null;

    try {
      const invite = await telegram<InviteLink>("createChatInviteLink", {
        chat_id: input.chatId,
        name: `AdsGalaxy Tracking ${account}`,
        expire_date: Math.floor(Date.now() / 1000) + 600,
        member_limit: 1,
        creates_join_request: false,
      });

      if (!invite.ok || !invite.result?.invite_link) {
        errors.push(`account_${account}:${safeReason(invite.description || "invite_create_failed")}`);
        continue;
      }

      createdInvite = invite.result.invite_link;
      const joined = await joinPrivateInviteWithAccount(account, createdInvite);
      if (joined.ok) {
        await markActive(input.channelId, account, joined.memberStatus, input.schema);
        return { status: "active", tracking_account: account, member_status: joined.memberStatus, manual_usernames };
      }

      errors.push(`account_${account}:${safeReason(joined.code)}`);
    } finally {
      if (createdInvite) {
        await telegram("revokeChatInviteLink", { chat_id: input.chatId, invite_link: createdInvite }).catch(() => null);
      }
    }
  }

  const reason = safeReason(errors.join(";") || "tracking_join_failed");
  await markPendingManual(input.channelId, reason, input.schema);
  return { status: "pending_manual", reason, manual_usernames };
}

export { getTrackingAccountUsernames };
