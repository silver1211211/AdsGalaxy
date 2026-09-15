type ApiErrorPayload = {
  error?: unknown;
  message?: unknown;
  code?: unknown;
};

export function getApiErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as ApiErrorPayload;
  if (typeof candidate.code === "string") return candidate.code;
  if (candidate.error && typeof candidate.error === "object") {
    const nested = candidate.error as ApiErrorPayload;
    return typeof nested.code === "string" ? nested.code : null;
  }
  return null;
}

export function getApiErrorMessage(payload: unknown, fallback: string, locale: Locale = "en"): string {
  if (!payload || typeof payload !== "object") return fallback;
  const code = getApiErrorCode(payload);
  if (locale !== "en" && code) return localizedApiError(code, locale);
  const candidate = payload as ApiErrorPayload;
  const safeMessages: Record<string, string> = {
    INSUFFICIENT_AD_BALANCE: "Your Ad Balance is too low for this action.",
    CAMPAIGN_BUDGET_EXHAUSTED: "This campaign has reached its budget.",
    BOT_NOT_ADMIN: "Add Ads Galaxy Bot as a channel administrator.",
    BOT_INVITE_PERMISSION_REQUIRED: "Allow Ads Galaxy Bot to invite users.",
    INVALID_DESTINATION_CHANNEL: "We couldn't verify this Telegram channel.",
    BUDGET_BELOW_ALREADY_SPENT: "Budget cannot be lower than the amount already spent.",
    IMAGE_TOO_LARGE: "Image must be 1 MB or smaller.",
    MODERATION_REASON_REQUIRED: "Select a rejection reason before confirming.",
    MODERATION_REASON_INVALID: "The selected rejection reason is no longer valid. Refresh and try again.",
    MODERATION_REASON_WRONG_SCOPE: "The selected reason does not apply to this item.",
    ENTITY_NOT_REJECTABLE: "This item changed status and can no longer be rejected.",
    ENTITY_NOT_FOUND: "This item could not be found.",
    UNAUTHORIZED: "Your admin session has expired. Sign in again.",
    FORBIDDEN: "You do not have permission to perform this action.",
  };
  if (code && safeMessages[code]) return safeMessages[code];
  const sanitize = (message: string) => /SQLSTATE|ER_[A-Z_]+|\/www\/|stack|token|secret/i.test(message) ? fallback : message;
  if (typeof candidate.error === "string" && candidate.error.trim()) return sanitize(candidate.error);
  if (candidate.error && typeof candidate.error === "object") {
    const nested = candidate.error as ApiErrorPayload;
    if (typeof nested.message === "string" && nested.message.trim()) return sanitize(nested.message);
  }
  if (typeof candidate.message === "string" && candidate.message.trim()) return sanitize(candidate.message);
  return fallback;
}
import { localizedApiError } from "@/i18n/apiErrors";
import type { Locale } from "@/i18n";
