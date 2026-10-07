import { redirect } from "next/navigation";
import SilverControlClient from "@/components/silver/SilverControlClient";
import { requireSilverAdmin } from "@/lib/silverCampaignControl";

export default async function SilverControlPage() {
  const { response } = await requireSilverAdmin();
  if (response) redirect("/check/silver/login");
  return <SilverControlClient />;
}
