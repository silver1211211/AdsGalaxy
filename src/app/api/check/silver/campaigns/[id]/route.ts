import {
  handleCampaignDetailsGet,
  handleCampaignDetailsPatch,
} from "@/app/api/admin/campaigns/[id]/route";
import { handleSilverApiRequest } from "@/lib/silverCampaignControl";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleSilverApiRequest(
    () => handleCampaignDetailsGet(request, context, "silver"),
    "Unable to load campaign details.",
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleSilverApiRequest(
    () => handleCampaignDetailsPatch(request, context, "silver"),
    "Unable to save campaign changes.",
  );
}
