import { NextResponse } from "next/server";
import {
  getSmartSettings,
  listRecommendations,
  recommendationSummary,
  refreshAdminRecommendations,
  updateRecommendation,
  updateSmartAutomationMode,
  type AutomationMode,
} from "@/lib/smartRecommendations";

export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    await refreshAdminRecommendations();
    const [recommendations, summary, settings] = await Promise.all([
      listRecommendations({
        audience: "admin",
        status: searchParams.get("status") || "open",
        type: searchParams.get("type") || "all",
        limit: Number(searchParams.get("limit") || 100),
      }),
      recommendationSummary("admin"),
      getSmartSettings(),
    ]);
    return NextResponse.json({ recommendations, summary, settings });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load smart recommendations" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.automation_mode) {
      await updateSmartAutomationMode(clean(body.automation_mode) as AutomationMode);
    }
    if (body.id) {
      await updateRecommendation(Number(body.id), {
        status: clean(body.status) as any,
        feedback: clean(body.feedback) as any,
      });
    }
    const settings = await getSmartSettings();
    return NextResponse.json({ success: true, settings });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to update recommendation" }, { status: 400 });
  }
}
