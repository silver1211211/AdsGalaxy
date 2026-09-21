export const TECHNICAL_STATUSES = new Set(["channel_not_found", "bot_removed", "permission_missing", "missing_chat_id"]);

export const PERMANENT_FAILURE_THRESHOLD = 3;
export const INDEPENDENT_FAILURE_WINDOW_MS = 30 * 60 * 1000;

export function parseAuditValue(value) {
  if (value == null || typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return {}; }
}

export function classifyTelegramFailure(response = {}) {
  const reason = String(response.description || "Telegram verification failed");
  const text = reason.toLowerCase();
  if (response.parameters?.migrate_to_chat_id) return { code: "chat_migrated", reason, permanent: false };
  if (text.includes("too many requests") || text.includes("retry after")) {
    return {
      code: "rate_limited",
      reason,
      permanent: false,
      retryAfterSeconds: Number(response.parameters?.retry_after || 0),
    };
  }
  if (text.includes("timeout") || text.includes("timed out") || text.includes("fetch failed")
    || text.includes("temporarily unavailable") || text.includes("bad gateway")
    || text.includes("internal server error")) {
    return { code: "temporary_error", reason, permanent: false };
  }
  // Bot API can return chat-not-found for a valid channel when the bot lost
  // access. Treat it only as a demotion candidate; persisted independent
  // failures are required before status can change.
  if (text.includes("chat not found") || text.includes("channel_invalid")) {
    return { code: "channel_not_found", reason, permanent: true };
  }
  if (text.includes("member list is inaccessible") || text.includes("exists but ads galaxy bot is not an administrator")) {
    return { code: "bot_access_lost", reason, permanent: true };
  }
  if (text.includes("kicked") || text.includes("not a member") || text.includes("user not found")) {
    return { code: "bot_removed", reason, permanent: true };
  }
  if (text.includes("not enough rights") || text.includes("not an administrator") || text.includes("need administrator")) {
    return { code: "permission_missing", reason, permanent: true };
  }
  return { code: "temporary_error", reason, permanent: false };
}

export function nextFailureState({
  previousCode,
  previousCount = 0,
  previousFailureAt = null,
  health,
  now = new Date(),
}) {
  if (!health || health.code === "healthy") {
    return { count: 0, firstFailureAt: null, nextRetryAt: null, demote: false };
  }
  const previousAt = previousFailureAt ? new Date(previousFailureAt) : null;
  const independent = !previousAt
    || now.getTime() - previousAt.getTime() >= INDEPENDENT_FAILURE_WINDOW_MS;
  const sameFailure = previousCode === health.code;
  const count = independent ? (sameFailure ? Number(previousCount || 0) + 1 : 1) : Number(previousCount || 0);
  const delayMinutes = health.code === "rate_limited" && Number(health.retryAfterSeconds) > 0
    ? Math.max(15, Math.ceil(Number(health.retryAfterSeconds) / 60))
    : health.permanent ? Math.min(360, 30 * Math.max(1, count)) : 15;
  return {
    count,
    firstFailureAt: sameFailure && previousCount > 0 ? undefined : now,
    nextRetryAt: new Date(now.getTime() + delayMinutes * 60 * 1000),
    demote: Boolean(health.permanent && independent && count >= PERMANENT_FAILURE_THRESHOLD),
  };
}

export function technicalStatusForHealth(code) {
  if (code === "bot_removed" || code === "bot_access_lost") return "bot_removed";
  if (code === "permission_missing") return "permission_missing";
  return "channel_not_found";
}

export function classifyRejectionHistory(currentStatus, audits = []) {
  const ordered = [...audits].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const rejection = [...ordered].reverse().find((audit) => audit.action === "reject");
  const recovery = [...ordered].reverse().find((audit) => ["resume", "bulk_approve", "reinstate"].includes(audit.action));
  if (rejection && (!recovery || new Date(rejection.created_at) > new Date(recovery.created_at))) {
    const oldStatus = String(parseAuditValue(rejection.old_value)?.status || "");
    if (TECHNICAL_STATUSES.has(oldStatus)) return "technical_rejection";
    if (oldStatus === "pending" || oldStatus === "active") return "policy_rejection";
    return "ambiguous_rejection";
  }
  return currentStatus === "rejected" ? "ambiguous_rejection" : "none";
}

export function recoveryDecision({ currentStatus, telegramHealthy, rejectionKind = "none", independentPolicyBlock = false }) {
  if (rejectionKind === "policy_rejection") return { status: "rejected", reason: "manual_policy_rejection_preserved" };
  if (rejectionKind === "ambiguous_rejection") return { status: "rejected", reason: "manual_review_required" };
  if (independentPolicyBlock) return { status: currentStatus, reason: "policy_block_preserved" };
  if (!telegramHealthy) return { status: currentStatus, reason: "telegram_not_healthy" };
  if (rejectionKind === "technical_rejection") return { status: "active", reason: "technical_rejection_recovered" };
  if (TECHNICAL_STATUSES.has(currentStatus)) {
    return {
      status: "active",
      reason: currentStatus === "channel_not_found" ? "recovered_by_chat_id" : currentStatus === "bot_removed" ? "bot_readded" : "permission_restored",
    };
  }
  return { status: currentStatus, reason: "healthy" };
}

export function usernameUpdateAllowed({ channelChatId, collisionChatId }) {
  return collisionChatId == null || String(collisionChatId) === String(channelChatId);
}

export function retryDelayMs(response, attempt) {
  const retryAfter = Number(response?.parameters?.retry_after || 0);
  return retryAfter > 0 ? (retryAfter + 1) * 1000 : Math.min(10_000, Math.max(1, attempt) * 1500);
}
