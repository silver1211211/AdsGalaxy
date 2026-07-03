import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { POSTING_TIME_OPTIONS } from "@/lib/postingTimes";
import { createSystemLog, maskEntityId } from "@/lib/systemLogs";

export type ChannelStatusType =
  | "active"
  | "paused"
  | "bot_removed"
  | "channel_not_found"
  | "deleted"
  | "permission_missing";

type Db = typeof pool | PoolConnection;

type ChannelScheduleRow = RowDataPacket & {
  id: number;
};

type ChannelHealthInput = {
  id: number | string;
  chat_id: string | number;
};

type HealthResult = {
  ok: boolean;
  status: ChannelStatusType;
  reason: string | null;
  suggestedFix: string | null;
  permanent: boolean;
};

function deterministicWeight(id: number) {
  let value = id >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function permanentFailure(description: string) {
  const normalized = description.toLowerCase();
  if (normalized.includes("chat not found") || normalized.includes("channel_invalid")) {
    return {
      status: "channel_not_found" as const,
      reason: "Channel not found or deleted.",
      suggestedFix: "Confirm the channel exists, add AdsGalaxy bot again, then reactivate.",
    };
  }
  if (normalized.includes("bot was kicked") || normalized.includes("bot is not a member") || normalized.includes("user not found")) {
    return {
      status: "bot_removed" as const,
      reason: "AdsGalaxy bot was removed from the channel.",
      suggestedFix: "Re-add AdsGalaxy bot as administrator and reactivate.",
    };
  }
  if (normalized.includes("not enough rights") || normalized.includes("not an administrator") || normalized.includes("need administrator")) {
    return {
      status: "permission_missing" as const,
      reason: "AdsGalaxy bot does not have posting permission.",
      suggestedFix: "Grant AdsGalaxy bot administrator posting permission and reactivate.",
    };
  }
  return null;
}

async function telegram(method: string, payload: Record<string, unknown>) {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is missing");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.json();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function channelLifecycleLogHook(_event: string, _payload: Record<string, unknown>) {
  void _event;
  void _payload;
  // Future integration point for System Logs, Posting Logs, and Channel Health Logs.
}

export async function ensureDefaultChannelDistribution(db: Db = pool) {
  const [channels] = await db.query<ChannelScheduleRow[]>(
    "SELECT id FROM channels WHERE status = 'active' AND is_deleted = FALSE AND COALESCE(health_status, 'healthy') IN ('healthy','warning') ORDER BY id ASC"
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
         AND COALESCE(health_status, 'healthy') IN ('healthy','warning')
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
  let lastResult: HealthResult | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await checkChannelHealthOnce(channel);
    if (result.ok) return result;

    lastResult = result;
    if (attempt < 3) {
      await sleep(500 * attempt);
    }
  }

  return lastResult || {
    ok: false,
    status: "paused",
    reason: "Unable to verify channel.",
    suggestedFix: "Try again later or verify channel access.",
    permanent: false,
  };
}

async function checkChannelHealthOnce(channel: ChannelHealthInput): Promise<HealthResult> {
  try {
    const chat = await telegram("getChat", { chat_id: channel.chat_id });
    if (!chat.ok) {
      const permanent = permanentFailure(chat.description || "");
      if (permanent) return { ok: false, permanent: true, ...permanent };
      return { ok: false, status: "paused", reason: chat.description || "Unable to verify channel.", suggestedFix: "Try again later or verify channel access.", permanent: false };
    }

    const me = await telegram("getMe", {});
    if (!me.ok || !me.result?.id) {
      return { ok: false, status: "paused", reason: "Unable to verify AdsGalaxy bot.", suggestedFix: "Try again later.", permanent: false };
    }

    const member = await telegram("getChatMember", { chat_id: channel.chat_id, user_id: me.result.id });
    if (!member.ok) {
      const permanent = permanentFailure(member.description || "");
      if (permanent) return { ok: false, permanent: true, ...permanent };
      return { ok: false, status: "paused", reason: member.description || "Unable to verify bot permissions.", suggestedFix: "Try again later.", permanent: false };
    }

    const status = member.result?.status;
    const canPost = status === "creator" || (status === "administrator" && member.result?.can_post_messages !== false);
    if (!canPost) {
      return {
        ok: false,
        status: status === "left" || status === "kicked" ? "bot_removed" : "permission_missing",
        reason: status === "left" || status === "kicked"
          ? "AdsGalaxy bot was removed from the channel."
          : "AdsGalaxy bot is not an administrator with posting permission.",
        suggestedFix: status === "left" || status === "kicked"
          ? "Re-add AdsGalaxy bot as administrator and reactivate."
          : "Grant AdsGalaxy bot posting permission and reactivate.",
        permanent: true,
      };
    }

    return { ok: true, status: "active", reason: null, suggestedFix: null, permanent: false };
  } catch (error: unknown) {
    return {
      ok: false,
      status: "paused",
      reason: error instanceof Error ? error.message : "Temporary Telegram verification failure.",
      suggestedFix: "Try again later.",
      permanent: false,
    };
  }
}

export async function markChannelHealthSuccess(channelId: number | string, db: Db = pool) {
  await db.query(
    `UPDATE channels
     SET health_status = 'healthy',
         health_checked_at = NOW(),
         failure_reason = NULL
     WHERE id = ?`,
    [channelId]
  );
}

export async function autoPauseChannel(channelId: number | string, health: HealthResult, db: Db = pool) {
  await db.query(
    `UPDATE channels
     SET status = ?,
         paused_reason = ?,
         suggested_fix = ?,
         failure_reason = ?,
         last_failure_at = NOW(),
         health_checked_at = NOW(),
         health_status = 'critical',
         auto_paused_at = NOW()
     WHERE id = ?`,
    [health.status, health.reason, health.suggestedFix, health.reason, channelId]
  );

  await createSystemLog({
    logType: "channel_health",
    status: "failed",
    title: "Channel auto-paused",
    summary: `Channel auto-paused because ${health.reason || "channel health failed"}`,
    autoPausedCount: 1,
    failedCount: 1,
    failureReasons: { [health.status]: 1 },
    affectedEntities: { channels: [maskEntityId("channel", channelId)] },
    metadata: {
      health_status: health.status,
      suggested_fix: health.suggestedFix,
    },
  }, db);

  channelLifecycleLogHook("channel_auto_paused", {
    channel_id: channelId,
    status: health.status,
    reason: health.reason,
  });
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
  const health = await checkChannelHealth({ id: channelId, chat_id: chatId });
  if (!health.ok) {
    if (health.permanent) {
      await autoPauseChannel(channelId, health, db);
    } else {
      await recordChannelPostFailure(channelId, health.reason || "Temporary health check failure", db);
    }
    throw new Error(health.reason || "Channel health check failed");
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

export function classifyTelegramSendFailure(description?: string) {
  return permanentFailure(description || "");
}
