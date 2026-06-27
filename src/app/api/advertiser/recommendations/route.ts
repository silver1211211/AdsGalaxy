import { NextResponse } from "next/server";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import {
  listRecommendations,
  recommendationSummary,
  refreshAdvertiserRecommendations,
  updateRecommendation,
} from "@/lib/smartRecommendations";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const { searchParams } = new URL(request.url);
    await refreshAdvertiserRecommendations(Number(user.id));
    const [recommendations, summary] = await Promise.all([
      listRecommendations({
        audience: "advertiser",
        ownerUserId: Number(user.id),
        status: searchParams.get("status") || "open",
        type: searchParams.get("type") || "all",
        limit: Number(searchParams.get("limit") || 100),
      }),
      recommendationSummary("advertiser", Number(user.id)),
    ]);
    return NextResponse.json({ recommendations, summary });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load recommendations" }, { status: getAuthErrorStatus(error) });
  }
}

export async function PATCH(request: Request) {
  try {
    await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const body = await request.json().catch(() => ({}));
    await updateRecommendation(Number(body.id), {
      status: clean(body.status) as any,
      feedback: clean(body.feedback) as any,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to update recommendation" }, { status: getAuthErrorStatus(error) });
  }
}
