const SQL_ERROR_PATTERNS = [
  "sql",
  "database",
  "er_",
  "data truncated",
  "duplicate entry",
  "foreign key",
  "syntax",
  "stack",
];

export function publicApiErrorMessage(error: unknown, fallback: string, status: number) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : "";

  const lower = message.toLowerCase();
  if (status >= 500 || SQL_ERROR_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return fallback;
  }

  return message || fallback;
}
