import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/adminAuth";
import { getCampaignDeliveryStatus } from "@/lib/campaignAdminOperations";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const { id } = await params;
    const status = await getCampaignDeliveryStatus(Number(id));
    return NextResponse.json({ success: true, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "campaign_delivery_status_failed";
    console.error("Admin campaign delivery status failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
