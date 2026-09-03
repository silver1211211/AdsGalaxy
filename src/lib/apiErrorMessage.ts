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

export function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const candidate = payload as ApiErrorPayload;
  if (typeof candidate.error === "string" && candidate.error.trim()) return candidate.error;
  if (candidate.error && typeof candidate.error === "object") {
    const nested = candidate.error as ApiErrorPayload;
    if (typeof nested.message === "string" && nested.message.trim()) return nested.message;
  }
  if (typeof candidate.message === "string" && candidate.message.trim()) return candidate.message;
  return fallback;
}
