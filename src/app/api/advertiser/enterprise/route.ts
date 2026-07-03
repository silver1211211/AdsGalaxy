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
      .filter((item: Record<string, unknown>) => ["premium", "elite", "sponsored"].includes(String(item.enterprise_inventory_tier)))
      .slice(0, 60)
      .map((item: Record<string, unknown>) => ({
        inventory_type: item.inventory_type,
        id: item.id,
        name: item.name,
        username: item.username,
        tier: item.enterprise_inventory_tier,
        estimated_reach: Number(item.estimated_monthly_impressions || 0),
        estimated_cpm: Number(item.estimated_cpm || 0),
        category: item.category,
        country: item.country,
        admin_approval_required: true,
      }));

    return NextResponse.json({
      packages: packages.map((item: Record<string, unknown>) => ({
        id: item.id,
        name: item.name,
        slug: item.slug,
        description: item.description,
        miniapp_impressions: item.miniapp_impressions,
        channel_posts: item.channel_posts,
        bot_broadcasts: item.bot_broadcasts,
        featured_marketplace_days: item.featured_marketplace_days,
        priority_support: item.priority_support,
        estimated_reach: item.estimated_reach,
        estimated_cpm: item.estimated_cpm,
        package_price: item.package_price,
      })),
      premium_options: premiumOptions,
      admin_approval_required: true,
      message: "Enterprise deals require admin approval before activation.",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load enterprise options";
    return NextResponse.json({ error: message }, { status: getAuthErrorStatus(error) });
  }
}
