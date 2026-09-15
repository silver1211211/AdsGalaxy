import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import type { ChannelPrivacySchema } from "@/lib/channelPrivacy";
import {
  getConfiguredMtprotoAccountNumbers,
  getMtprotoAccountAvailability,
  getTrackingAccountUsernames,
  joinPrivateInviteWithAccount,
  type MtprotoAccountNumber,
} from "@/lib/telegramMtproto";

type TelegramResponse<T = unknown> = {
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

type NamedLockRow = RowDataPacket & {
  acquired: number | string | null;
};

type TrackingAccountLoadRow = RowDataPacket & {
  tracking_account: number | string | null;
  active_count: number | string | null;
  assigned_count: number | string | null;
};

type ExistingTrackingRow = RowDataPacket & {
  tracking_account: number | string | null;
  tracking_account_status: string | null;
  tracking_account_member_status: string | null;
};

type ExistingTrackingAssignment = {
  account: MtprotoAccountNumber | null;
  status: string;
  memberStatus: string;
};

export type TrackingOnboardingResult =
  | { status: "not_required"; manual_usernames: ReturnType<typeof getTrackingAccountUsernames> }
  | { status: "active"; tracking_account: MtprotoAccountNumber; member_status: string; manual_usernames: ReturnType<typeof getTrackingAccountUsernames> }
  | { status: "pending_manual"; reason: string; manual_usernames: ReturnType<typeof getTrackingAccountUsernames> };

const TRACKING_ASSIGNMENT_LOCK = "adsgalaxy_private_tracking_assignment_v1";
const TRACKING_ASSIGNMENT_LOCK_TIMEOUT_SECONDS = 20;

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

async function telegram<T = unknown>(method: string, body: Record<string, unknown>): Promise<TelegramResponse<T>> {
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
    [account, memberStatus === "member" || memberStatus === "already_member" ? "member" : memberStatus, channelId]
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

async function withTrackingAssignmentLock<T>(run: () => Promise<T>): Promise<T> {
  const connection = await pool.getConnection();
  let acquired = false;

  try {
    const [rows] = await connection.query<NamedLockRow[]>(
      "SELECT GET_LOCK(?, ?) AS acquired",
      [TRACKING_ASSIGNMENT_LOCK, TRACKING_ASSIGNMENT_LOCK_TIMEOUT_SECONDS]
    );
    acquired = Number(rows[0]?.acquired) === 1;
    if (!acquired) throw new Error("tracking_assignment_busy");
    return await run();
  } finally {
    if (acquired) {
      await connection.query("SELECT RELEASE_LOCK(?)", [TRACKING_ASSIGNMENT_LOCK]).catch(() => undefined);
    }
    connection.release();
  }
}

async function getExistingTrackingAssignment(channelId: number | string): Promise<ExistingTrackingAssignment> {
  const [rows] = await pool.query<ExistingTrackingRow[]>(
    `SELECT tracking_account, tracking_account_status, tracking_account_member_status
     FROM channels
     WHERE id = ?
     LIMIT 1`,
    [channelId]
  );

  const row = rows[0];
  const account = Number(row?.tracking_account);
  return {
    account: account === 1 || account === 2 ? account as MtprotoAccountNumber : null,
    status: String(row?.tracking_account_status || ""),
    memberStatus: String(row?.tracking_account_member_status || ""),
  };
}

async function reserveTrackingAccount(channelId: number | string, account: MtprotoAccountNumber) {
  await pool.query(
    `UPDATE channels
     SET tracking_account = ?,
         tracking_account_assigned_at = COALESCE(tracking_account_assigned_at, NOW())
     WHERE id = ?
       AND COALESCE(tracking_account_status, '') <> 'active'`,
    [account, channelId]
  );
}

async function clearTrackingReservation(channelId: number | string, account: MtprotoAccountNumber) {
  await pool.query(
    `UPDATE channels
     SET tracking_account = NULL
     WHERE id = ?
       AND tracking_account = ?
       AND COALESCE(tracking_account_status, '') <> 'active'`,
    [channelId, account]
  );
}

export async function chooseTrackingAccountOrder(
  configuredAccounts: MtprotoAccountNumber[]
): Promise<MtprotoAccountNumber[]> {
  if (configuredAccounts.length <= 1) return [...configuredAccounts];

  const placeholders = configuredAccounts.map(() => "?").join(",");
  const [rows] = await pool.query<TrackingAccountLoadRow[]>(
    `SELECT
       tracking_account,
       SUM(CASE
         WHEN tracking_account_status = 'active'
          AND tracking_account_member_status IN ('member', 'already_member')
         THEN 1 ELSE 0
       END) AS active_count,
       COUNT(*) AS assigned_count
     FROM channels
     WHERE tracking_account IN (${placeholders})
     GROUP BY tracking_account`,
    configuredAccounts
  );

  const load = new Map<MtprotoAccountNumber, { active: number; assigned: number }>(
    configuredAccounts.map((account) => [account, { active: 0, assigned: 0 }])
  );

  for (const row of rows) {
    const account = Number(row.tracking_account);
    if (account !== 1 && account !== 2) continue;
    load.set(account, {
      active: Math.max(0, Number(row.active_count || 0)),
      assigned: Math.max(0, Number(row.assigned_count || 0)),
    });
  }

  return [...configuredAccounts].sort((left, right) => {
    const leftLoad = load.get(left) || { active: 0, assigned: 0 };
    const rightLoad = load.get(right) || { active: 0, assigned: 0 };
    return leftLoad.active - rightLoad.active
      || leftLoad.assigned - rightLoad.assigned
      || left - right;
  });
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

  try {
    return await withTrackingAssignmentLock(async () => {
      const existing = await getExistingTrackingAssignment(input.channelId);
      const existingIsActive = existing.status === "active"
        && (existing.memberStatus === "member" || existing.memberStatus === "already_member");

      if (existing.account && existingIsActive && configuredAccounts.includes(existing.account)) {
        return {
          status: "active" as const,
          tracking_account: existing.account,
          member_status: "member",
          manual_usernames,
        };
      }

      if (existing.account && existingIsActive) {
        return {
          status: "pending_manual" as const,
          reason: `account_${existing.account}:missing_account_session`,
          manual_usernames,
        };
      }

      const balancedOrder = await chooseTrackingAccountOrder(configuredAccounts);
      const accountOrder = existing.account && configuredAccounts.includes(existing.account)
        ? [existing.account, ...balancedOrder.filter((account) => account !== existing.account)]
        : balancedOrder;
      const errors: string[] = [];

      for (const account of accountOrder) {
        const availability = getMtprotoAccountAvailability(account);
        if (!availability.available) {
          errors.push(`account_${account}:${safeReason(availability.code)}`);
          continue;
        }

        let createdInvite: string | null = null;

        try {
          await reserveTrackingAccount(input.channelId, account);
          const invite = await telegram<InviteLink>("createChatInviteLink", {
            chat_id: input.chatId,
            name: `AdsGalaxy Tracking ${account}`,
            expire_date: Math.floor(Date.now() / 1000) + 600,
            member_limit: 1,
            creates_join_request: false,
          });

          if (!invite.ok || !invite.result?.invite_link) {
            errors.push(`account_${account}:${safeReason(invite.description || "invite_create_failed")}`);
            await clearTrackingReservation(input.channelId, account);
            continue;
          }

          createdInvite = invite.result.invite_link;
          const joined = await joinPrivateInviteWithAccount(account, createdInvite);
          if (joined.ok) {
            await markActive(input.channelId, account, joined.memberStatus, input.schema);
            return {
              status: "active" as const,
              tracking_account: account,
              member_status: joined.memberStatus,
              manual_usernames,
            };
          }

          errors.push(`account_${account}:${safeReason(joined.code)}`);
          await clearTrackingReservation(input.channelId, account);
        } finally {
          if (createdInvite) {
            await telegram("revokeChatInviteLink", { chat_id: input.chatId, invite_link: createdInvite }).catch(() => null);
          }
        }
      }

      const reason = safeReason(errors.join(";") || "tracking_join_failed");
      await markPendingManual(input.channelId, reason, input.schema);
      return { status: "pending_manual" as const, reason, manual_usernames };
    });
  } catch (error) {
    const reason = safeReason(error instanceof Error ? error.message : error);
    if (reason === "tracking_assignment_busy") {
      return { status: "pending_manual", reason, manual_usernames };
    }
    await markPendingManual(input.channelId, reason, input.schema);
    return { status: "pending_manual", reason, manual_usernames };
  }
}

export { getTrackingAccountUsernames };
