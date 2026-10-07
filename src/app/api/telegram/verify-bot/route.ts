import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authenticatePublisherAsset, PublisherAssetError, publisherAssetErrorResponse, publisherAssetTelemetry } from "@/lib/publisherAssetOnboarding";
import { verifyPublicBotIdentity } from "@/lib/telegramBotIdentity";

export async function GET(request: Request) {
  const requestId = randomUUID();
  let publisherId: number | undefined;
  publisherAssetTelemetry("miniapp_onboarding", { requestId, stage: "attempt", result: "started" });
  try {
    const user = await authenticatePublisherAsset(request);
    publisherId = Number(user.id);
    publisherAssetTelemetry("miniapp_onboarding", { requestId, publisherId, stage: "auth", result: "success" });

    const { searchParams } = new URL(request.url);
    const identity = await verifyPublicBotIdentity(searchParams.get("username"), searchParams.get("bot_id"));
    publisherAssetTelemetry("miniapp_onboarding", { requestId, publisherId, stage: "telegram_identity", result: "success", botUsername: identity.username, telegramBotId: identity.id });
    const response = NextResponse.json({ id: identity.id, username: identity.username, first_name: identity.firstName, verified: true, matches: true });
    response.headers.set("X-Request-Id", requestId);
    return response;
  } catch (error: unknown) {
    const code = error instanceof PublisherAssetError ? error.code : "BOT_VERIFICATION_FAILED";
    publisherAssetTelemetry("miniapp_onboarding", { requestId, publisherId, stage: "telegram_identity", result: "failed", code });
    const response = error instanceof PublisherAssetError ? publisherAssetErrorResponse(error) : NextResponse.json({ error: "Bot verification is temporarily unavailable.", code: "TELEGRAM_TEMPORARILY_UNAVAILABLE", retryable: true }, { status: 503 });
    response.headers.set("X-Request-Id", requestId);
    return response;
  }
}
