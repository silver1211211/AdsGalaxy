import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { POSTING_TIME_OPTIONS } from "@/lib/postingTimes";
import { getChannelPrivacySchema } from "@/lib/channelPrivacy";
import { onboardPrivateChannelTracking } from "@/lib/privateChannelTrackingOnboarding";
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
  const state: TelegramAccessState = health.status === "bot_removed" || health.status === "permission_missing"
    || health.status === "channel_not_found" || health.status === "restricted"
    ? health.status
    : "temporarily_unavailable";
  await persistTelegramChannelAccess({ channelId, source: "legacy_auto_pause", autoPauseActive: true }, {
    ok: false, state, reason: health.reason, reasonCode: state, checkedAt: new Date(),
    telegramChatId: null, username: null, title: null, channelType: null, botRole: null,
    canPostMessages: false, permanent: health.permanent, retryable: !health.permanent,
    retryAfterSeconds: health.retryAfterMs ? Math.ceil(health.retryAfterMs / 1000) : null,
  }, db);
}

export async function recordChannelPostSuccess(channelId: number | string, db: Db = pool) {
  await db.query(
    `UPDATE channels
     SET last_successful_post_at = NOW(),
         last_failure_at = NULL,
         failure_reason = NULL,
         health_status = CASE WHEN health_status IS NULL OR health_status NOT IN ('warning','critical','disabled') THEN 'healthy' ELSE health_status END,
         health_checked_at = NOW()
     WHERE id = ?`,
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
  const access = await verifyTelegramChannelAccess({
    channelId, chatId, source: "publisher_reactivate", persist: true, autoPauseActive: false,
  }, db);
  const health = legacyHealth(access);
  if (!access.ok) throw new Error(access.reason || "Channel health check failed");

  const [channelRows] = await db.query<RowDataPacket[]>(
    "SELECT channel_type FROM channels WHERE id = ? LIMIT 1",
    [channelId]
  );
  const channelType = channelRows[0]?.channel_type === "private" ? "private" : "public";
  const tracking = await onboardPrivateChannelTracking({
    channelId,
    chatId,
    channelType,
    schema: await getChannelPrivacySchema(),
  });
  if (channelType === "private" && tracking.status !== "active") {
    throw new Error(`Private channel MTProto membership is not verified: ${tracking.status === "pending_manual" ? tracking.reason : "tracking_not_active"}`);
  }

  await db.query(
    `UPDATE channels
     SET status = 'active',
         is_deleted = FALSE,
         paused_reason = NULL,
         suggested_fix = NULL,
         failure_reason = NULL,
         health_status = 'healthy',
         health_checked_at = NOW(),
         reactivated_at = NOW()
     WHERE id = ?`,
    [channelId]
  );

  await ensureDefaultChannelDistribution(db);
  return health;
}

export function classifyTelegramSendFailure(description?: string): {
  status: ChannelStatusType;
  reason: string | null;
  suggestedFix: string;
} | null {
  const failure = classifyTelegramAccessFailure({ description });
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
