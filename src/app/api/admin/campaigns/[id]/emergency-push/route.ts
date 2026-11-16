import { handleCampaignEmergencyPush } from "@/lib/campaignEmergencyPushHandler";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleCampaignEmergencyPush(request, context, "main");
}
