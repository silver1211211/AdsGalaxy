import pool from "@/lib/db";
import { getMtprotoChannelMemberCount, type ChannelMemberCountResult } from "@/lib/telegramMtproto";
import { authoritativeMemberCount, canAutoRestore, parseFloodWait, thresholdTransition } from "@/lib/channelRefreshPolicy";

export type CountResult = { ok: true; count: number } | { ok: false; code: string; retryAfterSeconds?: number };
type Query = (sql: string, params?: unknown[]) => Promise<unknown>;
export type RefreshDeps = {
  query: Query;
  transaction?: <T>(work: (query: Query) => Promise<T>) => Promise<T>;
  publicCount: (chatId: string) => Promise<CountResult>;
  privateCount: (channel: any, onHealth: (account: string, status: "healthy" | "unhealthy", code?: string) => Promise<void>) => Promise<ChannelMemberCountResult>;
};

export function classifyTelegramFailure(value: unknown) {
  const text = String(value || "unknown").toUpperCase();
  if (text.includes("FLOOD")) return "flood_wait";
  if (text.includes("AUTH") || text.includes("SESSION")) return "session_auth_error";
  if (text.includes("TIMEOUT")) return "timeout";
  if (text.includes("PRIVATE") || text.includes("FORBIDDEN")) return "permission_denied";
  if (text.includes("NOT_FOUND")) return "channel_inaccessible";
  return "transient_network";
}

export async function fetchPublicMemberCount(chatId: string, fetcher: typeof fetch = fetch): Promise<CountResult> {
  const token = process.env.BOT_TOKEN;
  if (!token) return { ok: false, code: "missing_bot_token" };
  try {
    const response = await fetcher(`https://api.telegram.org/bot${token}/getChatMemberCount?chat_id=${encodeURIComponent(chatId)}`, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
    const body = await response.json() as { ok?: boolean; result?: unknown; description?: unknown; parameters?: { retry_after?: number } };
    const count = authoritativeMemberCount(body.result);
    if (response.ok && body.ok && count.ok) return count;
    const wait = Number(body.parameters?.retry_after) || parseFloodWait(body.description);
    return { ok: false, code: wait ? "flood_wait" : body.ok ? "member_count_unavailable" : classifyTelegramFailure(body.description || response.status), ...(wait ? { retryAfterSeconds: wait } : {}) };
  } catch (error) {
    const wait = parseFloodWait(error);
    return { ok: false, code: wait ? "flood_wait" : classifyTelegramFailure(error), ...(wait ? { retryAfterSeconds: wait } : {}) };
  }
}

const defaultDeps: RefreshDeps = {
  query: (sql, params) => pool.query(sql, params),
  transaction: async (work) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work((sql, params) => connection.query(sql, params));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
  publicCount: fetchPublicMemberCount,
  privateCount: (channel, onHealth) => getMtprotoChannelMemberCount(channel.chat_id, channel.tracking_account, onHealth),
};

function transitionKeyPart(value: unknown) {
  return new Date(value as string | number | Date).toISOString();
}

async function insertTransitionAudit(query: Query, input: {
  channel: any; previousStatus: string; newStatus: string; reasonCode: string; count: number;
  minimum: number; belowSince: Date | string | null; idempotencyKey: string;
}) {
  await query(
    `INSERT IGNORE INTO channel_subscriber_transition_audits
      (channel_id,publisher_user_id,previous_status,new_status,reason_code,member_count,minimum_threshold,below_minimum_since,actor,idempotency_key,metadata)
     VALUES(?,?,?,?,?,?,?,?, 'system',?,?)`,
    [input.channel.id, input.channel.user_id, input.previousStatus, input.newStatus, input.reasonCode, input.count, input.minimum, input.belowSince, input.idempotencyKey, JSON.stringify({ source: "subscriber_refresh", channel_type: input.channel.channel_type || "unknown" })]
  );
}

export async function refreshSubscriberChannel(channel: any, minimum: number, now = new Date(), deps: RefreshDeps = defaultDeps) {
  const health = async (account: string, status: "healthy" | "unhealthy", code?: string) => {
    await deps.query(
      `INSERT INTO telegram_tracking_account_health(account_key,status,last_success_at,last_auth_failure_at,last_error_code,manual_reauthorization_required)
       VALUES(?,?,IF(?='healthy',?,NULL),IF(?='unhealthy',?,NULL),?,?)
       ON DUPLICATE KEY UPDATE status=VALUES(status),last_success_at=COALESCE(VALUES(last_success_at),last_success_at),last_auth_failure_at=COALESCE(VALUES(last_auth_failure_at),last_auth_failure_at),last_error_code=VALUES(last_error_code),manual_reauthorization_required=VALUES(manual_reauthorization_required)`,
      [account, status, status, now, status, now, code || null, status === "unhealthy" ? 1 : 0]
    );
  };
  const result = channel.channel_type === "private" ? await deps.privateCount(channel, health) : await deps.publicCount(channel.chat_id);
  if (!result.ok) {
    const retry = result.retryAfterSeconds ? new Date(now.getTime() + Math.min(86400, result.retryAfterSeconds) * 1000) : null;
    const failureCode = result.code || "subscriber_refresh_failed";
    await deps.query("UPDATE channels SET subscribers_last_attempt_at=?,subscribers_fetch_status='failed',subscribers_fetch_error_code=?,subscribers_consecutive_failures=subscribers_consecutive_failures+1,subscribers_next_retry_at=? WHERE id=?", [now, failureCode, retry, channel.id]);
    return { status: "failed", code: failureCode, nextRetryAt: retry };
  }

  const previousBelowSince = channel.below_minimum_since ? new Date(channel.below_minimum_since) : null;
  const mayRestore = canAutoRestore(channel, now);
  const transition = thresholdTransition({ count: result.count, minimum, belowSince: previousBelowSince, lowChecks: Number(channel.below_minimum_success_count || 0), now, canRestore: mayRestore });
  const pause = transition.action === "pause" || transition.action === "review";
  const restore = transition.action === "restore";
  const nextStatus = pause ? "paused" : restore ? "active" : String(channel.status);
  const run = deps.transaction || (async <T>(work: (query: Query) => Promise<T>) => work(deps.query));

  await run(async (query) => {
    await query(
      `UPDATE channels SET subscriber_count=?,last_subscriber_update_at=?,subscribers_last_success_at=?,subscribers_last_attempt_at=?,subscribers_next_retry_at=NULL,subscribers_fetch_status='success',subscribers_fetch_error_code=NULL,subscribers_consecutive_failures=0,below_minimum_since=?,below_minimum_success_count=?,below_minimum_review_required=?,below_minimum_review_required_at=CASE WHEN ? THEN COALESCE(below_minimum_review_required_at,?) ELSE NULL END,status=CASE WHEN ? THEN 'paused' WHEN ? THEN 'active' ELSE status END,monetization_paused_reason=CASE WHEN ? THEN 'below_minimum' WHEN ? THEN NULL ELSE monetization_paused_reason END,monetization_auto_paused_at=CASE WHEN ? THEN COALESCE(monetization_auto_paused_at,?) ELSE monetization_auto_paused_at END,monetization_auto_restored_at=CASE WHEN ? THEN ? ELSE monetization_auto_restored_at END WHERE id=?`,
      [result.count, now, now, now, transition.belowSince, transition.lowChecks, transition.reviewRequired, transition.reviewRequired, now, pause, restore, pause, restore, pause, now, restore, now, channel.id]
    );

    if (["grace", "pause", "review"].includes(transition.action)) {
      const since = transition.belowSince || now;
      const reason = transition.action === "grace" ? "BELOW_MINIMUM_GRACE_STARTED" : transition.action === "pause" ? "BELOW_MINIMUM_AUTO_PAUSED" : "BELOW_MINIMUM_SEVEN_DAY_REVIEW";
      await insertTransitionAudit(query, { channel, previousStatus: String(channel.status), newStatus: nextStatus, reasonCode: reason, count: result.count, minimum, belowSince: since, idempotencyKey: `channel-subscriber-${transition.action}:${channel.id}:${transitionKeyPart(since)}` });
    }
    if (previousBelowSince && result.count >= minimum) {
      const recoveryBase = `channel-subscriber-recovery:${channel.id}:${transitionKeyPart(previousBelowSince)}`;
      await insertTransitionAudit(query, { channel, previousStatus: String(channel.status), newStatus: nextStatus, reasonCode: "BELOW_MINIMUM_RECOVERY_DETECTED", count: result.count, minimum, belowSince: previousBelowSince, idempotencyKey: recoveryBase });
      await insertTransitionAudit(query, { channel, previousStatus: String(channel.status), newStatus: nextStatus, reasonCode: restore ? "BELOW_MINIMUM_AUTO_RESTORED" : "RESTORATION_WITHHELD_OTHER_RESTRICTION", count: result.count, minimum, belowSince: previousBelowSince, idempotencyKey: `${recoveryBase}:${restore ? "restored" : "withheld"}` });
    }
  });
  return { status: transition.action, count: result.count };
}
