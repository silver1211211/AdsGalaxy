import { handleCampaignAction } from "@/lib/campaignActionsHandler";
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
