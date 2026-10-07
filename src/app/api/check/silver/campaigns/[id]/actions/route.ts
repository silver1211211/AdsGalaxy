import { handleCampaignAction } from "@/app/api/admin/campaigns/[id]/actions/route";
import { handleSilverApiRequest } from "@/lib/silverCampaignControl";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleSilverApiRequest(
    () => handleCampaignAction(request, context, "silver"),
    "Unable to complete this campaign action.",
  );
}
