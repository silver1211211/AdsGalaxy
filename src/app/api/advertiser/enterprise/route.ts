import { NextResponse } from "next/server";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { listEnterpriseInventory, listPackages } from "@/lib/enterpriseDeals";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const { searchParams } = new URL(request.url);
    const [packages, inventory] = await Promise.all([
      listPackages(undefined, true),
      listEnterpriseInventory({
        type: searchParams.get("type") || "all",
        search: searchParams.get("search") || "",
        tier: searchParams.get("tier") || "all",
      }),
    ]);

    const premiumOptions = inventory
      .filter((item: any) => ["premium", "elite", "sponsored"].includes(String(item.enterprise_inventory_tier)))
      .slice(0, 60)
      .map((item: any) => ({
        inventory_type: item.inventory_type,
        id: item.id,
        name: item.name,
        username: item.username,
        tier: item.enterprise_inventory_tier,
        estimated_reach: Number(item.estimated_monthly_impressions || 0),
        estimated_cpm: Number(item.estimated_cpm || 0),
        category: item.category,
        country: item.country,
        traffic_quality_score: Number(item.traffic_quality_score || 0),
        admin_approval_required: true,
      }));

    return NextResponse.json({
      packages,
      premium_options: premiumOptions,
      admin_approval_required: true,
      message: "Enterprise deals require admin approval before activation.",
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to load enterprise options" }, { status: getAuthErrorStatus(error) });
  }
}
