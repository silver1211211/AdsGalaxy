import pool from "@/lib/db";
import { getAuthenticatedUserStatus } from "@/lib/auth";
import type { RowDataPacket } from "mysql2/promise";

export class PublisherAssetError extends Error {
  constructor(public code: string, message: string, public status = 400, public retryAfter = 0) { super(message); }
}

/** Canonical write authentication for publisher-owned assets. */
export async function authenticatePublisherAsset(request: Request) {
  const origin = request.headers.get("origin");
  let originMatches = true;
  try { originMatches = !origin || new URL(origin).host === (request.headers.get("host") || new URL(request.url).host); }
  catch { originMatches = false; }
  if (request.headers.get("sec-fetch-site") === "cross-site" || !originMatches) {
    throw new PublisherAssetError("UNAUTHORIZED", "Please reopen AdsGalaxy and try again.", 403);
  }
  const identity = await getAuthenticatedUserStatus(request.headers.get("x-telegram-init-data"), { request });
  const [rows] = await pool.query<Array<RowDataPacket & { id: number; telegram_id: string; status: string }>>(
    "SELECT id,telegram_id,status FROM users WHERE id=? LIMIT 1", [identity.id],
  );
  const user = rows[0];
  if (!user || !/^\d+$/.test(String(user.telegram_id))) throw new PublisherAssetError("UNAUTHORIZED", "Please reopen AdsGalaxy and try again.", 401);
  if (String(user.status).toLowerCase() === "banned") throw new PublisherAssetError("PUBLISHER_RESTRICTED", "This publisher account is restricted.", 403);
  return user;
}

export function publisherAssetErrorResponse(error: PublisherAssetError) {
  return Response.json({ error: error.message, code: error.code, message: error.message, retryable: error.status === 429 || error.status === 503 }, {
    status: error.status, headers: error.retryAfter ? { "Retry-After": String(error.retryAfter) } : undefined,
  });
}

export function publisherAssetTelemetry(event: "miniapp_onboarding" | "bot_onboarding", input: {
  requestId: string; stage: string; result: string; publisherId?: number; code?: string; botUsername?: string; telegramBotId?: string;
}) {
  console.info(JSON.stringify({ event, at: new Date().toISOString(), ...input }));
}
