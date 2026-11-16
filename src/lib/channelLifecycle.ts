import { recordChannelStatusTransitionAudit } from "@/lib/channelStatusAudit";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { POSTING_TIME_OPTIONS } from "@/lib/postingTimes";
import { getChannelPrivacySchema } from "@/lib/channelPrivacy";
import { onboardPrivateChannelTracking } from "@/lib/privateChannelTrackingOnboarding";
import { getPublicChannelApprovalEligibility } from "@/lib/publicChannelApproval";
import { evaluateUnifiedChannelEligibility } from "@/lib/channelEligibility";
import {
  classifyTelegramAccessFailure,
  persistTelegramChannelAccess,
  verifyTelegramChannelAccess,
  type TelegramAccessResult,
  type TelegramAccessState,
} from "@/lib/telegramChannelAccess";

export type ChannelStatusType =
  | "pending"
  | "active"
  | "paused"
  | "rejected"
  | "bot_removed"
  | "channel_not_found"
  | "deleted"
  | "permission_missing"
  | "restricted";

type Db = typeof pool | PoolConnection;

type ChannelScheduleRow = RowDataPacket & {
  id: number;
};

type ChannelHealthInput = {
  id: number | string;
  chat_id: string | number;
};

export type HealthResult = {
  ok: boolean;
  status: ChannelStatusType;
  reason: string | null;
  suggestedFix: string | null;
  permanent: boolean;
  retryAfterMs?: number;
  retryable?: boolean;
};

function deterministicWeight(id: number) {
  let value = id >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function suggestedFix(state: TelegramAccessState) {
  if (state === "bot_removed") return "Re-add Ads Galaxy bot as administrator and resume manually.";
  if (state === "channel_not_found") return "Confirm the stored Telegram channel identity, then verify again.";
  if (state === "restricted") return "Resolve the Telegram restriction, then verify and resume manually.";
  if (state === "permission_missing") return "Grant Ads Galaxy bot administrator posting permission, then resume manually.";
  return "Retry the Telegram access check later.";
}

function legacyHealth(result: TelegramAccessResult): HealthResult {
  let status: ChannelStatusType = "paused";
  if (result.ok) status = "active";
  else if (result.state === "bot_removed" || result.state === "permission_missing"
    || result.state === "channel_not_found" || result.state === "restricted") status = result.state;
  return {
    ok: result.ok,
    status,
    reason: result.reason,
    suggestedFix: result.ok ? null : suggestedFix(result.state),
    permanent: result.permanent,
    retryable: result.retryable,
    retryAfterMs: result.retryAfterSeconds ? result.retryAfterSeconds * 1000 : undefined,
  };
}

export function channelLifecycleLogHook(_event: string, _payload: Record<string, unknown>) {
  void _event;
  void _payload;
  // Future integration point for System Logs, Posting Logs, and Channel Health Logs.
}

export async function ensureDefaultChannelDistribution(db: Db = pool) {
  const [channels] = await db.query<ChannelScheduleRow[]>(
    "SELECT id FROM channels WHERE status = 'active' AND is_deleted = FALSE ORDER BY id ASC"
  );

  const randomized = [...channels].sort((a, b) => deterministicWeight(Number(a.id)) - deterministicWeight(Number(b.id)));
  const total = randomized.length;
  const base = Math.floor(total / POSTING_TIME_OPTIONS.length);
  const remainder = total % POSTING_TIME_OPTIONS.length;
  const assignments = new Map<number, { slot: string; index: number }>();
  let cursor = 0;

  POSTING_TIME_OPTIONS.forEach((slot, index) => {
    const size = base + (index < remainder ? 1 : 0);
    for (let offset = 0; offset < size && cursor < randomized.length; offset += 1) {
      assignments.set(Number(randomized[cursor].id), { slot, index });
      cursor += 1;
    }
  });

  for (const channel of channels) {
    const assignment = assignments.get(Number(channel.id));
    if (!assignment) continue;
    await db.query(
      `UPDATE channels
       SET scheduler_slot = ?, scheduler_slot_index = ?, schedule_mode = COALESCE(NULLIF(schedule_mode, ''), 'default')
       WHERE id = ?
         AND status = 'active'
         AND is_deleted = FALSE
         AND (
           scheduler_slot IS NULL
           OR scheduler_slot <> ?
           OR scheduler_slot_index IS NULL
           OR scheduler_slot_index <> ?
         )`,
      [assignment.slot, assignment.index, channel.id, assignment.slot, assignment.index]
    );
  }

  channelLifecycleLogHook("channel_distribution_refreshed", {
    active_channels: total,
    slots: POSTING_TIME_OPTIONS.length,
    base_slot_size: base,
    remainder,
  });

  return { activeChannels: total, slots: POSTING_TIME_OPTIONS.length, baseSlotSize: base, remainder };
}

export async function checkChannelHealth(channel: ChannelHealthInput): Promise<HealthResult> {
  return legacyHealth(await verifyTelegramChannelAccess({
    channelId: channel.id,
    chatId: channel.chat_id,
    source: "legacy_health_check",
    persist: false,
  }));
}

export async function markChannelHealthSuccess(channelId: number | string, db: Db = pool) {
  await persistTelegramChannelAccess({ channelId, source: "legacy_health_success" }, {
    ok: true, state: "healthy", reason: null, reasonCode: null, checkedAt: new Date(),
    telegramChatId: null, username: null, title: null, channelType: null, botRole: null,
    canPostMessages: true, permanent: false, retryable: false, retryAfterSeconds: null,
  }, db);
}

export async function autoPauseChannel(channelId: number | string, health: HealthResult, db: Db = pool) {
  const classified = classifyTelegramAccessFailure({
    description: health.reason,
    httpStatus: health.permanent ? 403 : 503,
  });
  const isAmbiguous =
    classified.reasonCode === "chat_not_found_unconfirmed" ||
    classified.reasonCode === "member_list_inaccessible" ||
    classified.reasonCode === "telegram_rate_limited" ||
    classified.reasonCode === "telegram_temporarily_unavailable" ||
    classified.reasonCode === "telegram_unclassified_error";
  const state: TelegramAccessState = isAmbiguous
    ? "temporarily_unavailable"
    : health.status === "bot_removed" || health.status === "permission_missing"
      || health.status === "channel_not_found" || health.status === "restricted"
      ? health.status
      : "temporarily_unavailable";
  const permanent = isAmbiguous ? false : Boolean(health.permanent && classified.permanent);
  await persistTelegramChannelAccess({ channelId, source: "legacy_auto_pause", autoPauseActive: true }, {
    ok: false, state, reason: health.reason, reasonCode: classified.reasonCode || state, checkedAt: new Date(),
    telegramChatId: null, username: null, title: null, channelType: null, botRole: null,
    canPostMessages: false, permanent, retryable: !permanent,
    retryAfterSeconds: health.retryAfterMs ? Math.ceil(health.retryAfterMs / 1000) : classified.retryAfterSeconds,
  }, db);
}

export async function recordChannelPostSuccess(channelId: number | string, db: Db = pool) {
  await db.query(
    `UPDATE channels
     SET last_successful_post_at = NOW(),
         last_failure_at = NULL,
         failure_reason = NULL,
         telegram_access_state = 'healthy',
         health_status = CASE WHEN health_status IS NULL OR health_status NOT IN ('warning','critical','disabled') THEN 'healthy' ELSE health_status END,
         health_checked_at = NOW()
     WHERE id = ?`,
    [channelId]
  );
  await db.query(
    `UPDATE channel_telegram_identities
     SET verification_state = 'healthy',
         consecutive_failure_count = 0,
         next_retry_at = NULL,
         last_failure_code = NULL,
         last_failure_reason = NULL,
         last_success_at = UTC_TIMESTAMP(6)
     WHERE channel_id = ?`,
    [channelId]
  );
}

export async function recordChannelPostFailure(channelId: number | string, reason: string, db: Db = pool) {
  await db.query(
    `UPDATE channels
     SET last_failure_at = NOW(),
         failure_reason = ?,
         health_status = CASE WHEN health_status='critical' THEN health_status ELSE 'warning' END
     WHERE id = ?`,
    [reason.slice(0, 255), channelId]
  );
}

export async function reactivateChannelAfterHealthCheck(channelId: number | string, chatId: string | number, db: Db = pool) {
  const [channelRows] = await db.query<RowDataPacket[]>(
    `SELECT c.id, c.status, c.is_deleted, c.channel_type, c.chat_id, c.username,
            c.paused_reason, c.under_review, c.marketplace_admin_status,
            c.monetization_paused_reason, c.below_minimum_review_required,
            c.settlement_excluded_until, c.automation_suspension_status,
            c.automation_suspended_until, c.revenue_protection_status
     FROM channels c WHERE c.id = ? LIMIT 1`,
    [channelId]
  );
  const row = channelRows[0];
  if (row) {
    const pausedReasonLower = String(row.paused_reason || "").trim().toLowerCase();
    if (Boolean(row.is_deleted) || row.status === "deleted") {
      throw new Error("Deleted channels cannot be reactivated.");
    }
    if (row.status === "rejected" || row.marketplace_admin_status === "rejected") {
      throw new Error("Rejected channels cannot be reactivated without administrator approval.");
    }
    if (row.status === "pending" || (row.marketplace_admin_status && row.marketplace_admin_status !== "approved")) {
      throw new Error("Pending channels require administrator approval before activation.");
    }
    if (pausedReasonLower.startsWith("paused by admin") || pausedReasonLower.includes("platform operations")) {
      throw new Error("Channel was paused by an administrator and cannot be resumed by the publisher.");
    }
    if (Boolean(row.under_review)) {
      throw new Error("Channel is currently under manual moderation review.");
    }
    if (row.monetization_paused_reason === "below_minimum" || Boolean(row.below_minimum_review_required)) {
      throw new Error("Channel cannot be reactivated while below the minimum subscriber threshold.");
    }
    if (row.settlement_excluded_until && new Date(String(row.settlement_excluded_until)) > new Date()) {
      throw new Error("Channel has an active settlement hold.");
    }
    if (
      (row.automation_suspension_status && row.automation_suspension_status !== "active") ||
      (row.automation_suspended_until && new Date(String(row.automation_suspended_until)) > new Date())
    ) {
      throw new Error("Channel is suspended by automation safety controls.");
    }
    if (row.revenue_protection_status && row.revenue_protection_status !== "normal") {
      throw new Error("Channel is restricted by revenue protection controls.");
    }
    if (
      row.paused_reason === "fraudulent_or_low_quality_traffic" ||
      row.paused_reason === "Low Trust Score with Withdrawable Balance Threshold Reached"
    ) {
      throw new Error("Channel is paused due to traffic quality or trust enforcement.");
    }
  }

  const channelType = row?.channel_type === "private" ? "private" : "public";
  const effectiveChatId = row?.chat_id ?? chatId;
  let health: HealthResult;
  let verifiedAccess: TelegramAccessResult;
  if (channelType === "public") {
    verifiedAccess = await verifyTelegramChannelAccess({
      channelId,
      chatId: effectiveChatId,
      username: row?.username ?? null,
      source: "publisher_reactivate",
      persist: true,
      autoPauseActive: false,
    }, db);
    health = legacyHealth(verifiedAccess);
    if (!verifiedAccess.ok) throw new Error(verifiedAccess.reason || "Public channel Telegram access verification failed");
  } else {
    verifiedAccess = await verifyTelegramChannelAccess({
      channelId, chatId: effectiveChatId, source: "publisher_reactivate", persist: true, autoPauseActive: false,
    }, db);
    health = legacyHealth(verifiedAccess);
    if (!verifiedAccess.ok) throw new Error(verifiedAccess.reason || "Private channel access check failed");
    const tracking = await onboardPrivateChannelTracking({
      channelId,
      chatId: verifiedAccess.telegramChatId || effectiveChatId,
      channelType: "private",
      schema: await getChannelPrivacySchema(),
    });
    if (row.channel_type === "private" && tracking.status !== "active") {
      throw new Error(`Private channel MTProto membership is not verified: ${tracking.status === "pending_manual" ? tracking.reason : "tracking_not_active"}`);
    }
  }

  const isPool = typeof (db as unknown as { getConnection?: () => Promise<PoolConnection> }).getConnection === "function";
  const conn: Db = isPool ? await (db as unknown as { getConnection: () => Promise<PoolConnection> }).getConnection() : db;
  const inTx = typeof (conn as PoolConnection).beginTransaction === "function";

  if (inTx) await (conn as PoolConnection).beginTransaction();
  try {
    const [freshRows]: any = await conn.query(
      `SELECT c.*, u.status AS publisher_status, u.is_banned AS publisher_is_banned
       FROM channels c
       JOIN users u ON u.id = c.user_id
       WHERE c.id = ? ${inTx ? "FOR UPDATE" : ""}`,
      [channelId]
    );
    const fresh = freshRows?.[0] || row;
    if (!fresh || fresh.is_deleted) {
      throw new Error("Channel not found or deleted");
    }

    if (
      fresh.paused_by_actor === "admin" ||
      fresh.admin_paused_at != null ||
      (fresh.paused_reason && fresh.paused_reason.toLowerCase().includes("admin"))
    ) {
      throw new Error("Channel was paused by an administrator and cannot be resumed by the publisher.");
    }

    const eligibility = evaluateUnifiedChannelEligibility({
      ...fresh,
      context: "publisher_resume",
      live_verification_confirmed: true,
      bot_member_status: verifiedAccess.botRole || "administrator",
      bot_can_post: verifiedAccess.canPostMessages !== false,
      telegram_access_state: "healthy",
      verification_state: "healthy",
    });

    if (!eligibility.eligible) {
      throw new Error(`Channel cannot be resumed: ${eligibility.reason || eligibility.code}`);
    }

    const expectedVersion = Number(fresh.telegram_access_version || 0);
    const [reactivateRes]: any = await conn.query(
      `UPDATE channels
       SET status = 'active',
           is_deleted = FALSE,
           paused_reason = NULL,
           paused_by_actor = NULL,
           publisher_paused_at = NULL,
           suggested_fix = NULL,
           failure_reason = NULL,
           health_status = 'healthy',
           health_checked_at = NOW(),
           telegram_access_state = 'healthy',
           telegram_access_version = telegram_access_version + 1,
           reactivated_at = NOW()
       WHERE id = ?
         AND is_deleted = FALSE
         AND status NOT IN ('rejected', 'deleted', 'pending')
         AND COALESCE(paused_reason, '') NOT LIKE 'Paused by admin%'
         AND COALESCE(paused_by_actor, '') != 'admin'
         AND admin_paused_at IS NULL
         AND telegram_access_version = ?`,
      [channelId, expectedVersion]
    );

    if (Number(reactivateRes?.affectedRows || 0) === 1 && fresh && String(fresh.status) !== "active") {
      await recordChannelStatusTransitionAudit(conn, {
        channelId: Number(channelId),
        telegramChatId: effectiveChatId,
        previousStatus: String(fresh.status),
        newStatus: "active",
        sourceWorker: "publisher_manual_reactivate",
        reasonCode: "publisher_reactivated_after_telegram_check",
        reasonText: "Publisher reactivated channel after live Telegram health check",
        evidenceClassification: "recovery",
        verificationAttemptRef: effectiveChatId ? `chat:${effectiveChatId}` : null,
        actorType: "publisher",
        transitionIntent: "manual",
        recoveryAction: "manual_reactivate",
        recoveryOutcome: "reactivated",
        verificationVersion: expectedVersion + 1,
      });
    }

    if (inTx) await (conn as PoolConnection).commit();
  } catch (err) {
    if (inTx) await (conn as PoolConnection).rollback().catch(() => undefined);
    throw err;
  } finally {
    if (isPool && typeof (conn as PoolConnection).release === "function") {
      (conn as PoolConnection).release();
    }
  }

  await ensureDefaultChannelDistribution(db);
  return health;
}

export function classifyTelegramSendFailure(
  description?: string,
  options?: { httpStatus?: number | null; errorCode?: number | null; retryAfterSeconds?: number | null },
): {
  status: ChannelStatusType;
  reason: string | null;
  suggestedFix: string;
} | null {
  const failure = classifyTelegramAccessFailure({
    description,
    httpStatus: options?.httpStatus,
    errorCode: options?.errorCode,
    retryAfterSeconds: options?.retryAfterSeconds,
  });
  if (!failure.permanent) return null;
  let status: ChannelStatusType = "paused";
  if (failure.state === "bot_removed" || failure.state === "permission_missing"
    || failure.state === "channel_not_found" || failure.state === "restricted") status = failure.state;
  return {
    status,
    reason: failure.reason,
    suggestedFix: suggestedFix(failure.state),
  };
}
