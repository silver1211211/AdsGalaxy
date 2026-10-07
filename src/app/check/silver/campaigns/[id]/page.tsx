import { redirect } from "next/navigation";
import AdminCampaignDetailsPage from "@/app/admin/campaigns/[id]/page";
import { requireSilverAdmin } from "@/lib/silverCampaignControl";

export default async function SilverCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireSilverAdmin();
  if (response) redirect("/check/silver/login");
  await params;
  return <AdminCampaignDetailsPage silverMode />;
}
