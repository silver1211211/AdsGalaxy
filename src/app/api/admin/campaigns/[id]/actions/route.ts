import { handleCampaignAction } from "@/lib/campaignActionsHandler";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleCampaignAction(request, context, "main");
}
