import { handleCampaignDetailsGet, handleCampaignDetailsPatch } from "@/lib/campaignDetailsHandler";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleCampaignDetailsGet(request, context, "main");
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleCampaignDetailsPatch(request, context, "main");
}
