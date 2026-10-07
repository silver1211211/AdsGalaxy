export const VIEW_SHARD_COUNT = 4;

export type PublicViewFailureClass =
  | "genuine_post_not_found"
  | "channel_not_found"
  | "private_or_unsupported"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "provider_error"
  | "malformed_response"
  | "retryable_unknown";

export type PublicViewResult =
  | { ok: true; views: number; source: "public_api" }
  | { ok: false; code: PublicViewFailureClass; rawCode: string; retryAfterSeconds?: number };

export type ViewFailurePolicy = {
  terminal: boolean;
  retryAfterSeconds: number;
  classification: "temporary" | "operational" | "terminal";
};

const SECOND = 1_000;

export function positiveInt(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(value || "", 10);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback));
}

export function normalizePublicViewResult(input: {
  httpStatus: number;
  responseOk: boolean;
  payload: unknown;
  expectedChannel: string;
  expectedMessageId: string | number;
}): PublicViewResult {
  const body = input.payload && typeof input.payload === "object"
    ? input.payload as Record<string, unknown>
    : null;
  if (!body) return { ok: false, code: "malformed_response", rawCode: "non_object_payload" };

  const rawStatus = String(body.status || body.error || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  const returnedChannel = String(body.channel || body.username || "").replace(/^@/, "").toLowerCase();
  const returnedPost = body.post ?? body.message_id ?? body.messageId;
  if (returnedChannel && returnedChannel !== input.expectedChannel.replace(/^@/, "").toLowerCase()) {
    return { ok: false, code: "malformed_response", rawCode: "channel_mismatch" };
  }
  if (returnedPost !== undefined && String(returnedPost) !== String(input.expectedMessageId)) {
    return { ok: false, code: "malformed_response", rawCode: "message_mismatch" };
  }

  if (input.responseOk && rawStatus === "success") {
    const views = Number(body.views);
    if (Number.isSafeInteger(views) && views >= 0) return { ok: true, views, source: "public_api" };
    return { ok: false, code: "malformed_response", rawCode: "invalid_view_count" };
  }

  const retryAfter = Number(body.retry_after ?? body.retryAfter);
  const retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : undefined;
  if (input.httpStatus === 429 || /rate|flood|too-many/.test(rawStatus)) {
    return { ok: false, code: "rate_limited", rawCode: rawStatus || "http_429", retryAfterSeconds };
  }
  if (/post-not-found|message-not-found/.test(rawStatus)) {
    // The public provider alone is not authoritative enough to call this terminal.
    return { ok: false, code: "genuine_post_not_found", rawCode: rawStatus };
  }
  if (/channel-not-found|chat-not-found/.test(rawStatus)) return { ok: false, code: "channel_not_found", rawCode: rawStatus };
  if (/private|unsupported/.test(rawStatus)) return { ok: false, code: "private_or_unsupported", rawCode: rawStatus };
  if (input.httpStatus >= 500) return { ok: false, code: "provider_error", rawCode: rawStatus || `http_${input.httpStatus}` };
  if (!input.responseOk) return { ok: false, code: "provider_error", rawCode: rawStatus || `http_${input.httpStatus}` };
  return { ok: false, code: "retryable_unknown", rawCode: rawStatus || "unknown_public_error" };
}

export function classifyPublicTransportError(error: unknown): PublicViewResult {
  const message = error instanceof Error ? `${error.name}:${error.message}` : String(error || "unknown_error");
  const upper = message.toUpperCase();
  if (upper.includes("TIMEOUT") || upper.includes("ABORT")) return { ok: false, code: "timeout", rawCode: "timeout" };
  if (/ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|SOCKET|FETCH FAILED/.test(upper)) {
    return { ok: false, code: "network_error", rawCode: "network_error" };
  }
  return { ok: false, code: "retryable_unknown", rawCode: "transport_error" };
}

export function shouldRetryPublicImmediately(result: PublicViewResult) {
  return !result.ok && ["timeout", "network_error", "provider_error", "retryable_unknown"].includes(result.code);
}

export function shouldFallbackPublicToMtproto(result: PublicViewResult) {
  return !result.ok && result.rawCode !== "circuit_open" && [
    "genuine_post_not_found",
    "channel_not_found",
    "private_or_unsupported",
    "timeout",
    "network_error",
    "provider_error",
    "malformed_response",
    "retryable_unknown",
  ].includes(result.code);
}

export function classifyViewFailure(reason: string, retryAfterSeconds?: number | null): ViewFailurePolicy {
  const code = reason.toLowerCase();
  if (/message_id_invalid|confirmed_message_not_found|invalid_message_id/.test(code)) {
    return { terminal: true, retryAfterSeconds: 0, classification: "terminal" };
  }
  if (/channel_invalid|channel_not_found|identity_mismatch|expired_invite|no_verified_private_member|channel_private|not_channel_member/.test(code)) {
    return { terminal: false, retryAfterSeconds: 6 * 60 * 60, classification: "operational" };
  }
  if (/rate_limited|flood/.test(code)) {
    return { terminal: false, retryAfterSeconds: Math.max(1, retryAfterSeconds || 15 * 60), classification: "temporary" };
  }
  if (/timeout|network|provider|rpc|temporar|all_accounts|peer_entity|malformed|unknown/.test(code)) {
    return { terminal: false, retryAfterSeconds: 5 * 60, classification: "temporary" };
  }
  return { terminal: false, retryAfterSeconds: 15 * 60, classification: "temporary" };
}

export function encodeViewFailure(reason: string, retryAfterSeconds?: number | null) {
  const policy = classifyViewFailure(reason, retryAfterSeconds);
  const retry = policy.terminal ? "terminal" : `retry_after=${policy.retryAfterSeconds}`;
  return `${reason};class=${policy.classification};${retry}`.slice(0, 500);
}

export function acceptedMonotonicViews(stored: number, fetched: number) {
  if (!Number.isSafeInteger(fetched) || fetched < 0) throw new Error("invalid_view_count");
  return Math.max(Math.max(0, Math.floor(stored)), fetched);
}

export class PublicProviderCircuitBreaker {
  private consecutiveSystemFailures = 0;
  private openUntil = 0;

  constructor(private readonly threshold = 5, private readonly cooldownMs = 60_000) {}

  canRequest(now = Date.now()) {
    return now >= this.openUntil;
  }

  record(result: PublicViewResult, now = Date.now()) {
    if (result.ok || result.code === "genuine_post_not_found" || result.code === "channel_not_found" || result.code === "private_or_unsupported") {
      this.consecutiveSystemFailures = 0;
      return;
    }
    if (["timeout", "network_error", "provider_error", "malformed_response", "retryable_unknown"].includes(result.code)) {
      this.consecutiveSystemFailures += 1;
      if (this.consecutiveSystemFailures >= this.threshold) this.openUntil = now + this.cooldownMs;
    }
  }

  unavailableUntil() { return this.openUntil || null; }
}

export function viewWorkerHealth(input: {
  fatal?: boolean;
  overdue: number;
  oldestDeferredAgeSeconds: number;
  temporaryFailures: number;
  mtprotoUnavailable: boolean;
  publicProviderDegraded: boolean;
  warningBacklog: number;
  warningAgeSeconds: number;
}) {
  if (input.fatal) return "FAILED" as const;
  if (input.mtprotoUnavailable) return "MTPROTO_COOLDOWN" as const;
  if (input.publicProviderDegraded) return "TELEGRAM_DEGRADED" as const;
  if (input.overdue > input.warningBacklog || input.oldestDeferredAgeSeconds > input.warningAgeSeconds) return "BACKLOGGED" as const;
  if (input.temporaryFailures > 0) return "PARTIAL_FAILURE" as const;
  return "HEALTHY" as const;
}

export function hasExecutionBudget(startedAtMs: number, maximumRunMs: number, reserveMs: number, now = Date.now()) {
  return now - startedAtMs < maximumRunMs - reserveMs;
}

export const TEST_ONLY = { SECOND };
