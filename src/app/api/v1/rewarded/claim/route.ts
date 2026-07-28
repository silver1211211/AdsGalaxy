import { NextResponse } from "next/server";
import { logDeveloperApiRequest, validateDeveloperApiRequest } from "@/lib/developerPlatform";
import {
  claimRewardEvent,
  productionRewardCallbacksEnabled,
  RewardCallbackError,
} from "@/lib/miniappRewardEvents";
import { publicApiErrorMessage } from "@/lib/publicApiErrors";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: Request) {
  let context: any = null;
  try {
    context = await validateDeveloperApiRequest(
      request,
      "reward_validation",
      "/api/v1/rewarded/claim",
      { requiredKeyType: "private" }
    );
    if (!productionRewardCallbacksEnabled()) {
      throw Object.assign(new Error("Production reward claiming is not enabled"), { statusCode: 501 });
    }
    if (context.mode !== "production") {
      throw new RewardCallbackError(403, "REWARD_ENVIRONMENT_MISMATCH", "Production application required");
    }

    const body = await request.json().catch(() => ({}));
    const eventId = clean(body.event_id);
    const miniappId = Number(body.mini_app_id);
    const externalUserReference = clean(body.external_user_reference);
    const idempotencyKey = clean(request.headers.get("idempotency-key"));
    if (
      !eventId.startsWith("rwe_")
      || eventId.length > 64
      || !Number.isInteger(miniappId)
      || miniappId <= 0
      || !externalUserReference
      || !idempotencyKey
      || idempotencyKey.length > 160
    ) {
      throw new RewardCallbackError(
        400,
        "INVALID_CLAIM_REQUEST",
        "event_id, mini_app_id, external_user_reference and Idempotency-Key are required"
      );
    }

    const response = await claimRewardEvent({
      eventId,
      miniappId,
      applicationId: context.applicationId,
      apiKeyId: context.apiKeyId,
      userId: context.userId,
      environment: "production",
      externalUserReference,
      idempotencyKey,
    });
    await logDeveloperApiRequest(context, request, 200, true, {
      event_id: eventId,
      idempotency_key_present: true,
    });
    return NextResponse.json(response);
  } catch (error: any) {
    const status = Number(error?.statusCode || 400);
    const errorCode = error instanceof RewardCallbackError ? error.code : undefined;
    await logDeveloperApiRequest(context, request, status, false, {
      idempotency_key_present: Boolean(request.headers.get("idempotency-key")),
    }, error?.message);
    return NextResponse.json({
      error: publicApiErrorMessage(error, "Reward claim failed", status),
      ...(errorCode ? { error_code: errorCode } : {}),
    }, { status });
  }
}
