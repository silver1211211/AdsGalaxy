import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/adminAuth";
import { getCampaignSettlementSummary } from "@/lib/campaignAdminOperations";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const { id } = await params;
    const summary = await getCampaignSettlementSummary(Number(id));
    return NextResponse.json({ success: true, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "campaign_settlement_summary_failed";
    console.error("Admin campaign settlement summary failed", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
