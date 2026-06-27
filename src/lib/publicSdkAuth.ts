import { getAuthenticatedUser } from "@/lib/auth";

export type PublicSdkUser = {
  id: number;
  telegramUserId: string;
};

function sdkError(code: string, message: string, status = 400) {
  const error = new Error(message) as Error & { code: string; status: number };
  error.code = code;
  error.status = status;
  return error;
}

export async function requirePublicSdkUser(request: Request): Promise<PublicSdkUser> {
  const initData = request.headers.get("x-telegram-init-data");
  if (!initData) {
    throw sdkError("INVALID_INIT_DATA", "Telegram initData is required", 401);
  }

  try {
    const user = await getAuthenticatedUser(initData);
    return {
      id: Number(user.id),
      telegramUserId: String(user.telegram_id),
    };
  } catch (error: any) {
    const message = error?.message || "Invalid Telegram initData";
    const status = message.startsWith("Unauthorized") || message.startsWith("Invalid initData") ? 401 : 403;
    throw sdkError("INVALID_INIT_DATA", message, status);
  }
}

export function publicSdkErrorResponse(error: any, fallbackCode = "REQUEST_FAILED", fallbackMessage = "AdsGalaxy request failed") {
  return {
    success: false,
    error_code: error?.code || fallbackCode,
    message: error?.message || fallbackMessage,
  };
}
