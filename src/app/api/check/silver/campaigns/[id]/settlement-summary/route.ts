import { NextResponse } from "next/server";
import { getCampaignSettlementSummary } from "@/lib/campaignAdminOperations";
import {
  campaignBelongsToScope,
  reportSilverApiError,
  requireSilverAdmin,
} from "@/lib/silverCampaignControl";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response } = await requireSilverAdmin();
  if (response) return response;
  try {
    const { id } = await params;
    if (!(await campaignBelongsToScope(Number(id), "silver")))
      return NextResponse.json(
        { error: "Campaign not found" },
        { status: 404 },
      );
    return NextResponse.json({
      success: true,
      summary: await getCampaignSettlementSummary(Number(id)),
    });
  } catch (error) {
    reportSilverApiError("Unable to load campaign settlement summary", error);
    return NextResponse.json(
      { error: "Unable to load the settlement summary." },
      { status: 500 },
    );
  }
}
