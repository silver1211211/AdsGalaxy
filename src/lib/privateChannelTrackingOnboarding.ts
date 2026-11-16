import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import type { ChannelPrivacySchema } from "@/lib/channelPrivacy";
import {
  getConfiguredMtprotoAccountNumbers,
  getMtprotoAccountAvailability,
  getTrackingAccountUsernames,
  joinPrivateInviteWithAccount,
  confirmPrivateChannelMembership,
  type MtprotoAccountNumber,
} from "@/lib/telegramMtproto";

type TelegramResponse<T = unknown> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
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
  tracking_account_failure_reason: string | null;
  failure_age_seconds: number | string | null;
};

type ExistingTrackingAssignment = {
  account: MtprotoAccountNumber | null;
  status: string;
  memberStatus: string;
  failureReason: string;
  failureAgeSeconds: number | null;
};

export type TrackingOnboardingResult =
  | { status: "not_required"; manual_usernames: ReturnType<typeof getTrackingAccountUsernames> }
  | { status: "active"; tracking_account: MtprotoAccountNumber; member_status: string; manual_usernames: ReturnType<typeof getTrackingAccountUsernames> }
  | { status: "pending_manual"; reason: string; retryAfterSeconds?: number; manual_usernames: ReturnType<typeof getTrackingAccountUsernames> };

const TRACKING_ASSIGNMENT_LOCK = "adsgalaxy_private_tracking_assignment_v1";
const TRACKING_ASSIGNMENT_LOCK_TIMEOUT_SECONDS = 20;

function safeReason(value: unknown) {
  return String(value || "unknown")
    .replace(/https:\/\/t\.me\/(?:\+|joinchat\/)[A-Za-z0-9_-]+/g, "[invite_link]")
    .slice(0, 255);
}

export function privateTrackingFailureMessage(reason: string) {
  switch (reason) {
    case "rate_limited": return "Telegram is rate-limited. Retry private channel approval manually after the wait.";
    case "bot_token_missing": case "bot_auth_failed": return "AdsGalaxy bot credentials are unavailable or unauthorized. Restore bot access and retry.";
    case "chat_admin_required": return "Give the AdsGalaxy bot invite/add-member administrator permission.";
    case "join_request_pending": return "The tracking account's join request is awaiting approval; approve it and retry.";
    case "membership_unconfirmed": return "Telegram did not confirm the join. Check the tracking account's membership or pending join request, then retry manually.";
    case "invite_creation_unconfirmed": return "Telegram did not confirm invite creation. Wait for the possible invitation to expire, then retry manually.";
    case "invite_hash_invalid": case "invite_hash_expired": case "invite_hash_empty": case "invalid_invite_link": return "The private channel invitation is invalid or expired. Create a valid invite and retry.";
    case "session_unauthorized": case "session_revoked": case "session_password_needed": case "session_auth_error": case "auth_key_duplicated": case "account_deactivated": case "missing_account_sessions": return "The configured tracking account is not authorized. Restore its session and retry.";
    case "channel_private": case "peer_entity_unavailable": case "not_channel_member": return "The tracking account cannot access the private channel. Check membership and retry.";
    case "network_error": case "telegram_network_error": case "verification_timeout": case "telegram_rpc_error": return "Telegram could not be reached or did not complete the request. Retry manually later.";
    default: return "Private channel membership could not be confirmed. Review the reported tracking error and retry.";
  }
}

function classifyInviteFailure(response: TelegramResponse<unknown>): string {
  if (response.error_code === 429) return "rate_limited";
  if (Number(response.error_code) >= 500 || response.description === "telegram_network_error") return "invite_creation_unconfirmed";
  const description = String(response.description || "").toLowerCase();
  if (/not enough rights|insufficient rights|administrator rights|chat_admin_required|need administrator|need admin|not an administrator|not a chat administrator/.test(description)) return "chat_admin_required";
  if (/chat not found|channel_private|channel is private|bot was kicked|bot is not a member/.test(description)) return "channel_private";
  if (description === "bot_token_missing") return "bot_token_missing";
  if (response.error_code === 401 || /unauthorized|invalid token/.test(description)) return "bot_auth_failed";
  if (/network|timed? ?out|timeout/.test(description)) return "telegram_network_error";
  return "telegram_request_failed";
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
      signal: AbortSignal.timeout(10_000),
    });
    const data: TelegramResponse<T> = await response.json();
    if (response.status >= 500 && !data.error_code) data.error_code = response.status;
    if (response.status === 429 && !data.error_code) data.error_code = 429;
    return data;
  } catch {
    return { ok: false, description: "telegram_network_error" };
  }
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

async function markPendingManual(channelId: number | string, reason: string, schema: ChannelPrivacySchema, preserveAccount?: MtprotoAccountNumber | null) {
  if (!hasTrackingColumns(schema)) return;

  const viewTrackingUpdate = schema.hasViewTrackingStatus ? ", view_tracking_status = 'limited'" : "";
  await pool.query(
    `UPDATE channels
     SET tracking_account_status = 'pending_manual',
         tracking_account = ?,
         tracking_account_member_status = NULL,
         tracking_account_last_failure_at = NOW(),
         tracking_account_failure_reason = ?
         ${viewTrackingUpdate}
     WHERE id = ?`,
    [preserveAccount || null, safeReason(reason), channelId]
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
    `SELECT tracking_account, tracking_account_status, tracking_account_member_status, tracking_account_failure_reason,
            TIMESTAMPDIFF(SECOND, tracking_account_last_failure_at, NOW()) AS failure_age_seconds
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
    failureReason: String(row?.tracking_account_failure_reason || ""),
    failureAgeSeconds: row?.failure_age_seconds == null ? null : Math.max(0, Number(row.failure_age_seconds)),
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

  const configuredAccounts = getConfiguredMtprotoAccountNumbers();
  let recoveryAccount: MtprotoAccountNumber | null = null;
  let recoveryGuardReason: string | null = null;
  let recoveryExistingGuard = false;
  try {
    return await withTrackingAssignmentLock(async () => {
      try {
      if (configuredAccounts.length === 0) {
        await markPendingManual(input.channelId, "missing_account_sessions", input.schema);
        return { status: "pending_manual" as const, reason: "missing_account_sessions", manual_usernames };
      }
      const existing = await getExistingTrackingAssignment(input.channelId);
      recoveryAccount = existing.account;
      const existingIsActive = existing.status === "active"
        && (existing.memberStatus === "member" || existing.memberStatus === "already_member");
      const pendingJoinRequest = existing.status === "pending_manual" && existing.failureReason === "join_request_pending";
      // An uncertain join may be a still-pending request, even after its invite expires.
      const uncertainMembership = existing.status === "pending_manual" && existing.failureReason === "membership_unconfirmed";
      const uncertainInvite = existing.status === "pending_manual" && existing.failureReason === "invite_creation_unconfirmed"
        && (existing.failureAgeSeconds === null || existing.failureAgeSeconds < 600);
      const guardedReason = pendingJoinRequest || uncertainMembership || uncertainInvite ? existing.failureReason : null;
      recoveryGuardReason = guardedReason;
      recoveryExistingGuard = Boolean(guardedReason);
      if (guardedReason && (!existing.account || !configuredAccounts.includes(existing.account))) {
        return { status: "pending_manual" as const, reason: "missing_account_sessions", manual_usernames };
      }
      let alreadyCheckedWithoutAccess: MtprotoAccountNumber | null = null;

      if (existing.account && existingIsActive && configuredAccounts.includes(existing.account)) {
        const verified = await confirmPrivateChannelMembership(existing.account, input.chatId);
        if (verified.ok) return { status: "active" as const, tracking_account: existing.account, member_status: "member", manual_usernames };
        await markPendingManual(input.channelId, verified.code, input.schema, existing.account);
        if (!["not_channel_member", "peer_entity_unavailable", "channel_private"].includes(verified.code)) {
          return {status: "pending_manual" as const, reason: verified.code, retryAfterSeconds: verified.retryAfterSeconds, manual_usernames};
        }
        alreadyCheckedWithoutAccess = existing.account;
      }

      if (existing.account && existingIsActive && !configuredAccounts.includes(existing.account)) {
        await markPendingManual(input.channelId, "missing_account_sessions", input.schema);
        return {
          status: "pending_manual" as const,
          reason: "missing_account_sessions",
          manual_usernames,
        };
      }

      const balancedOrder = await chooseTrackingAccountOrder(configuredAccounts);
      const accountOrder = guardedReason && existing.account
        ? [existing.account]
        : existing.account && configuredAccounts.includes(existing.account)
          ? [existing.account, ...balancedOrder.filter((account) => account !== existing.account)]
          : balancedOrder;
      const errors: string[] = [];

      for (const account of accountOrder) {
        recoveryAccount = account;
        const availability = getMtprotoAccountAvailability(account);
        if (!availability.available) {
          if (availability.code === "rate_limited") {
            if (!guardedReason) await markPendingManual(input.channelId, availability.code, input.schema, account);
            return {status: "pending_manual" as const, reason: availability.code, retryAfterSeconds: availability.retryAfterSeconds, manual_usernames};
          }
          errors.push(`account_${account}:${safeReason(availability.code)}`);
          continue;
        }

        const currentMembership = account === alreadyCheckedWithoutAccess
          ? { ok: false as const, code: "not_channel_member" }
          : await confirmPrivateChannelMembership(account, input.chatId);
        if (currentMembership.ok) {
          await markActive(input.channelId, account, "already_member", input.schema);
          return { status: "active" as const, tracking_account: account, member_status: "already_member", manual_usernames };
        }
        if (currentMembership.code !== "not_channel_member" && currentMembership.code !== "peer_entity_unavailable" && currentMembership.code !== "channel_private") {
          if (!guardedReason) await markPendingManual(input.channelId, currentMembership.code, input.schema, account);
          return { status: "pending_manual" as const, reason: currentMembership.code, retryAfterSeconds: currentMembership.retryAfterSeconds, manual_usernames };
        }
        if (guardedReason) {
          // Pending requests and uncertain invitations must not be duplicated.
          const wait = uncertainInvite && existing.failureAgeSeconds !== null ? Math.max(1, 600 - existing.failureAgeSeconds) : undefined;
          return { status: "pending_manual" as const, reason: guardedReason, retryAfterSeconds: wait, manual_usernames };
        }

        let createdInvite: string | null = null;
        let keepInviteUntilExpiry = false;

        try {
          await reserveTrackingAccount(input.channelId, account);
          // Persist uncertainty before each external mutation so a process crash cannot duplicate it.
          recoveryGuardReason = "invite_creation_unconfirmed";
          await markPendingManual(input.channelId, recoveryGuardReason, input.schema, account);
          const invite = await telegram<InviteLink>("createChatInviteLink", {
            chat_id: input.chatId,
            name: `AdsGalaxy Tracking ${account}`,
            expire_date: Math.floor(Date.now() / 1000) + 600,
            member_limit: 1,
            creates_join_request: false,
          });

          if (!invite.ok || !invite.result?.invite_link) {
            const reason = classifyInviteFailure(invite);
            if (reason === "invite_creation_unconfirmed") recoveryGuardReason = reason;
            const retry = reason === "invite_creation_unconfirmed" ? 600 : Number(invite.parameters?.retry_after);
            await clearTrackingReservation(input.channelId, account);
            await markPendingManual(input.channelId, reason, input.schema, account);
            return { status: "pending_manual" as const, reason, retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? retry : undefined, manual_usernames };
          }

          createdInvite = invite.result.invite_link;
          recoveryGuardReason = "membership_unconfirmed";
          await markPendingManual(input.channelId, recoveryGuardReason, input.schema, account);
          const joined = await joinPrivateInviteWithAccount(account, createdInvite, input.chatId);
          if (joined.ok && ["member", "already_member"].includes(joined.memberStatus)) {
            await markActive(input.channelId, account, joined.memberStatus, input.schema);
            return {
              status: "active" as const,
              tracking_account: account,
              member_status: joined.memberStatus,
              manual_usernames,
            };
          }

          const reason = joined.ok ? "membership_unconfirmed" : joined.code;
          if (reason === "membership_unconfirmed" || reason === "join_request_pending") {
            recoveryGuardReason = reason;
            keepInviteUntilExpiry = true;
          }
          const retryAfterSeconds = joined.ok ? undefined : joined.retryAfterSeconds;
          await clearTrackingReservation(input.channelId, account);
          await markPendingManual(input.channelId, reason, input.schema, account);
          return { status: "pending_manual" as const, reason, retryAfterSeconds, manual_usernames };
        } finally {
          if (createdInvite && !keepInviteUntilExpiry) {
            await telegram("revokeChatInviteLink", { chat_id: input.chatId, invite_link: createdInvite }).catch(() => null);
          }
        }
      }

      const reason = safeReason(errors.join(";") || "tracking_join_failed");
      await markPendingManual(input.channelId, reason, input.schema);
      return { status: "pending_manual" as const, reason, manual_usernames };
      } catch (error) {
        const reason = safeReason(error instanceof Error ? error.message : error);
        if (!recoveryExistingGuard) await markPendingManual(input.channelId, recoveryGuardReason || reason, input.schema, recoveryAccount);
        return { status: "pending_manual" as const, reason, manual_usernames };
      }
    });
  } catch (error) {
    // Never write tracking state without holding the assignment lock.
    const reason = safeReason(error instanceof Error ? error.message : error);
    return { status: "pending_manual", reason, manual_usernames };
  }
}

export { getTrackingAccountUsernames };
