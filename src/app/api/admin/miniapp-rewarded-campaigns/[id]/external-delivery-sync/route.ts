import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import {
  controlMiniAppExternalDeliverySync,
  createMiniAppExternalDeliverySync,
  getMiniAppExternalDeliveryState,
  MiniAppExternalSyncError,
} from "@/lib/miniappExternalDeliverySync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function campaignId(raw: string) {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw new MiniAppExternalSyncError("Valid campaign id is required");
  return id;
}

function failure(error: unknown) {
  const status = error instanceof MiniAppExternalSyncError ? error.status : 500;
  const message = error instanceof Error ? error.message : "External delivery sync failed";
  return NextResponse.json({ error: status === 500 ? "External delivery sync failed" : message }, { status });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireAdminPermission("read");
  if (response) return response;
  try {
    return NextResponse.json(await getMiniAppExternalDeliveryState(campaignId((await params).id)));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { admin, response } = await requireAdminPermission("operate");
  if (response) return response;
  try {
    const id = campaignId((await params).id);
    const body = await request.json();
    const result = await createMiniAppExternalDeliverySync({
      campaignId: id,
      adminId: admin.id,
      targetImpressions: body.target_impressions,
      targetClicks: body.target_clicks,
      durationSeconds: body.duration_seconds,
    });
    await recordAdminActionAudit({
      adminId: admin.id,
      action: "miniapp_external_delivery_sync_created",
      entityType: "miniapp_rewarded_campaign",
      entityId: id,
      reason: "admin_update_delivery_totals",
      metadata: { sync_id: result.id, target_impressions: body.target_impressions, target_clicks: body.target_clicks, duration_seconds: body.duration_seconds },
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { admin, response } = await requireAdminPermission("operate");
  if (response) return response;
  try {
    const id = campaignId((await params).id);
    const body = await request.json();
    if (!["pause", "resume", "cancel"].includes(body.action)) {
      throw new MiniAppExternalSyncError("Action must be pause, resume, or cancel");
    }
    const result = await controlMiniAppExternalDeliverySync({ campaignId: id, action: body.action });
    await recordAdminActionAudit({
      adminId: admin.id,
      action: `miniapp_external_delivery_sync_${body.action}`,
      entityType: "miniapp_rewarded_campaign",
      entityId: id,
      reason: `admin_${body.action}_external_delivery_sync`,
      metadata: { sync_id: result.sync?.id || null },
    });
    return NextResponse.json(result);
  } catch (error) {
    return failure(error);
  }
}
