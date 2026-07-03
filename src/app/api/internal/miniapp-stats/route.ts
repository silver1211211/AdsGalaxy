import { NextResponse } from "next/server";
import { getAuthenticatedAdmin } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { recordMiniAppStats } from "@/lib/miniappStats";

function hasInternalAccess(request: Request) {
  const configuredSecret = process.env.MINIAPP_STATS_SECRET;
  if (!configuredSecret) return false;
  return request.headers.get("x-miniapp-stats-secret") === configuredSecret;
}

export async function POST(request: Request) {
  const admin = await getAuthenticatedAdmin();
  const internalAccess = hasInternalAccess(request);

  if (!admin && !internalAccess) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const result = await recordMiniAppStats({
      miniapp_id: Number(body.miniapp_id),
      network_name: String(body.network_name || ""),
      impressions: Number(body.impressions),
      gross_revenue: Number(body.gross_revenue),
      country: body.country ? String(body.country) : undefined,
      date: body.date ? String(body.date) : undefined,
    });

    if (admin) {
      await recordAdminActionAudit({
        adminId: admin.id,
        action: "import_miniapp_stats",
        entityType: "miniapp",
        entityId: result.miniapp_id,
        reason: "admin_stats_import",
        metadata: {
          admin_username: admin.username,
          previous_state: null,
          new_state: result,
        },
      });
    }

    return NextResponse.json({ success: true, stats: result });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to record Mini App stats" }, { status: 400 });
  }
}
