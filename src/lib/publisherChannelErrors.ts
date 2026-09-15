export type PublisherChannelErrorCode =
  | "INVALID_CHANNEL"
  | "INVALID_CHANNEL_USERNAME"
  | "INVALID_CHANNEL_TITLE"
  | "CHANNEL_BELOW_MINIMUM_SUBSCRIBERS"
  | "CHANNEL_NOT_ACCESSIBLE"
  | "CHANNEL_ALREADY_EXISTS"
  | "PERMISSION_REQUIRED"
  | "TELEGRAM_TEMPORARILY_UNAVAILABLE"
  | "DATABASE_TEMPORARILY_UNAVAILABLE"
  | "CHANNEL_CREATE_FAILED"
  | "CHANNEL_UPDATE_FAILED"
  | "CHANNEL_DELETE_FAILED"
  | "CHANNEL_LIST_FAILED"
  | "CHANNEL_ANALYTICS_FAILED";

const messages: Record<PublisherChannelErrorCode, string> = {
  INVALID_CHANNEL: "Please provide a valid Telegram channel.",
  INVALID_CHANNEL_USERNAME: "Please provide a valid public Telegram channel username.",
  INVALID_CHANNEL_TITLE: "The verified channel title must be between 3 and 128 characters.",
  CHANNEL_BELOW_MINIMUM_SUBSCRIBERS: "This channel does not meet the minimum subscriber requirement.",
  CHANNEL_NOT_ACCESSIBLE: "We could not access this channel. Please verify the bot permissions and try again.",
  CHANNEL_ALREADY_EXISTS: "This channel is already registered.",
  PERMISSION_REQUIRED: "The required channel permission is missing.",
  TELEGRAM_TEMPORARILY_UNAVAILABLE: "Telegram is temporarily unavailable. Please try again.",
  DATABASE_TEMPORARILY_UNAVAILABLE: "Channel registration is temporarily unavailable. Please try again in a moment.",
  CHANNEL_CREATE_FAILED: "We could not add this channel. Please verify access and try again.",
  CHANNEL_UPDATE_FAILED: "We could not update this channel. Please try again.",
  CHANNEL_DELETE_FAILED: "We could not remove this channel. Please try again.",
  CHANNEL_LIST_FAILED: "We could not load your channels. Please try again.",
  CHANNEL_ANALYTICS_FAILED: "We could not load channel analytics. Please try again.",
};

export function publisherChannelError(code: PublisherChannelErrorCode, status: number) {
  return Response.json({ error: { code, message: messages[code] } }, { status });
}

/** Log classifications only. Exception messages can contain SQL, invites, peer data, or credentials. */
export function logPublisherChannelError(operation: string, error: unknown) {
  const candidate = error as { name?: unknown; code?: unknown } | null;
  const safeCode = typeof candidate?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(candidate.code)
    ? candidate.code
    : "UNCLASSIFIED";
  const safeName = typeof candidate?.name === "string" && /^[A-Za-z]{1,40}$/.test(candidate.name)
    ? candidate.name
    : "Error";
  console.error("Publisher channel operation failed", { operation, error_name: safeName, error_code: safeCode });
}
