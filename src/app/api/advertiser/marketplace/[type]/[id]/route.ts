import { NextResponse } from "next/server";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { getMarketplaceProfile, listMarketplaceInventory, normalizeMarketplaceType, recordMarketplaceEvent } from "@/lib/publisherMarketplace";
import { publicAdvertiserInventory } from "@/lib/advertiserResponsePrivacy";

export async function GET(request: Request, context: { params: Promise<{ type: string; id: string }> }) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const params = await context.params;
    const type = normalizeMarketplaceType(params.type);
    const id = Number(params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid inventory" }, { status: 400 });
    }

    const profile = await getMarketplaceProfile(type, id, user.id);
    if (!profile) {
      return NextResponse.json({ error: "Inventory not found" }, { status: 404 });
    }

    await recordMarketplaceEvent({
      advertiserId: user.id,
      inventoryType: type,
      inventoryId: id,
      eventType: "profile_view",
      metadata: { source: "profile" },
    });

    const recommended = await listMarketplaceInventory({
      type,
      category: profile.category === "General" ? "" : profile.category,
      country: profile.country === "GLOBAL" ? "" : profile.country,
      language: profile.language === "All" ? "" : profile.language,
      limit: 6,
    }, user.id);

    return NextResponse.json({
      profile: publicAdvertiserInventory(profile),
      recommended: recommended.filter((item) => !(item.type === type && item.id === id)).slice(0, 5).map(publicAdvertiserInventory),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load inventory profile";
    return NextResponse.json({ error: message }, { status: getAuthErrorStatus(error) });
  }
}
