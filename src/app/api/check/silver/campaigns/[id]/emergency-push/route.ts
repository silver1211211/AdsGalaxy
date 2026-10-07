import { handleCampaignEmergencyPush } from "@/app/api/admin/campaigns/[id]/emergency-push/route";
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
