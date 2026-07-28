import { NextResponse } from "next/server";
import { logDeveloperApiRequest, validateDeveloperApiRequest } from "@/lib/developerPlatform";
import {
  getRewardEventByEventId,
  normalizeRewardEvent,
  productionRewardCallbacksEnabled,
  requireApplicationMiniappScope,
  RewardCallbackError,
} from "@/lib/miniappRewardEvents";
import { publicApiErrorMessage } from "@/lib/publicApiErrors";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ event_id: string }> }
) {
  let context: any = null;
  try {
    context = await validateDeveloperApiRequest(
      request,
      "reward_validation",
      "/api/v1/rewarded/events/[event_id]",
      { requiredKeyType: "private" }
    );
    if (!productionRewardCallbacksEnabled()) {
      throw Object.assign(new Error("Production reward event lookup is not enabled"), { statusCode: 501 });
    }
    if (context.mode !== "production") {
      throw new RewardCallbackError(403, "REWARD_ENVIRONMENT_MISMATCH", "Production application required");
    }

    const { event_id: eventId } = await params;
    const miniappId = Number(new URL(request.url).searchParams.get("mini_app_id"));
    if (!eventId.startsWith("rwe_") || eventId.length > 64 || !Number.isInteger(miniappId) || miniappId <= 0) {
      throw new RewardCallbackError(400, "INVALID_LOOKUP_REQUEST", "Valid event_id and mini_app_id are required");
    }
    await requireApplicationMiniappScope({
      applicationId: context.applicationId,
      miniappId,
      environment: "production",
      userId: context.userId,
    });
    const event = await getRewardEventByEventId(eventId);
    if (
      !event
      || Number(event.application_id) !== context.applicationId
      || Number(event.miniapp_id) !== miniappId
      || event.environment !== "production"
    ) {
      throw new RewardCallbackError(404, "REWARD_EVENT_NOT_FOUND", "Reward event is unavailable");
    }

    await logDeveloperApiRequest(context, request, 200, true, {
      request_id: event.request_id,
      event_id: event.event_id,
    });
    return NextResponse.json({
      success: true,
      api_version: "v1",
      environment: "production",
      event: normalizeRewardEvent(event),
    });
  } catch (error: any) {
    const status = Number(error?.statusCode || 400);
    const errorCode = error instanceof RewardCallbackError ? error.code : undefined;
    await logDeveloperApiRequest(context, request, status, false, undefined, error?.message);
    return NextResponse.json({
      error: publicApiErrorMessage(error, "Reward event lookup failed", status),
      ...(errorCode ? { error_code: errorCode } : {}),
    }, { status });
  }
}
