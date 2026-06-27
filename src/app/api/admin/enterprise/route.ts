import { NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import {
  createDirectDeal,
  createFeaturedListing,
  enterpriseSummary,
  listDeals,
  listEnterpriseInventory,
  listPackages,
  updateDealStatus,
  updateInventoryTier,
  upsertPackage,
} from "@/lib/enterpriseDeals";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const [summary, inventory, deals, packages] = await Promise.all([
    enterpriseSummary(),
    listEnterpriseInventory({
      type: searchParams.get("type") || "all",
      search: searchParams.get("search") || "",
      tier: searchParams.get("tier") || "all",
    }),
    listDeals(),
    listPackages(),
  ]);

  return NextResponse.json({ summary, inventory, deals, packages });
}

export async function POST(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const action = String(body.action || "");

    if (action === "create_deal") {
      const dealId = await createDirectDeal(body);
      return NextResponse.json({ success: true, deal_id: dealId });
    }
    if (action === "save_package") {
      const packageId = await upsertPackage(body);
      return NextResponse.json({ success: true, package_id: packageId });
    }
    if (action === "feature_listing") {
      await createFeaturedListing(body);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to save enterprise controls" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const action = String(body.action || "");

    if (action === "inventory_tier") {
      await updateInventoryTier({
        inventoryType: body.inventory_type,
        inventoryId: Number(body.inventory_id),
        tier: body.enterprise_inventory_tier,
        priorityScore: Number(body.enterprise_priority_score || 0),
        sponsorshipEnabled: Boolean(body.enterprise_sponsorship_enabled),
      });
      return NextResponse.json({ success: true });
    }

    if (["approve", "pause", "resume"].includes(action)) {
      await updateDealStatus(Number(body.deal_id), action);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to update enterprise controls" }, { status: 400 });
  }
}
