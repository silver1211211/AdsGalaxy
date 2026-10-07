import { NextResponse } from "next/server";
import {
  releaseCampaignToMain,
  reportSilverApiError,
  requireSilverAdmin,
} from "@/lib/silverCampaignControl";

export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { admin, response } = await requireSilverAdmin();
  if (response) return response;
  const { id } = await params;
  try {
    return NextResponse.json({
      success: true,
      ...(await releaseCampaignToMain(Number(id), Number(admin?.id))),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "RELEASE_FAILED";
    if (code === "CAMPAIGN_NOT_FOUND")
      return NextResponse.json(
        { error: "Campaign not found." },
        { status: 404 },
      );
    if (code === "CAMPAIGN_NOT_SILVER")
      return NextResponse.json(
        { error: "This campaign is no longer managed by Silver." },
        { status: 409 },
      );
    if (
      code === "CAMPAIGN_MANAGEMENT_BUSY" ||
      code === "CAMPAIGN_LIST_CHANGED"
    ) {
      return NextResponse.json(
        {
          error: "Campaign is currently being updated. Refresh and try again.",
        },
        { status: 409 },
      );
    }
    reportSilverApiError("Unable to release campaign", error);
    return NextResponse.json(
      { error: "Unable to release this campaign. Please try again." },
      { status: 500 },
    );
  }
}
