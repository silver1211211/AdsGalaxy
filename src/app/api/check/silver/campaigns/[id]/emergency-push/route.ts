import { handleCampaignEmergencyPush } from "@/lib/campaignEmergencyPushHandler";
import { handleSilverApiRequest } from "@/lib/silverCampaignControl";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleSilverApiRequest(
    () => handleCampaignEmergencyPush(request, context, "silver"),
    "Unable to run emergency delivery.",
  );
}
