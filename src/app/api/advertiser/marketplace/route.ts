import { NextResponse } from "next/server";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { listMarketplaceInventory, normalizeMarketplaceType, recordMarketplaceEvent } from "@/lib/publisherMarketplace";
import { publicAdvertiserInventory } from "@/lib/advertiserResponsePrivacy";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const { searchParams } = new URL(request.url);
    const typeParam = searchParams.get("type") || "all";
    const type = typeParam === "all" ? "all" : normalizeMarketplaceType(typeParam);

    const inventory = await listMarketplaceInventory({
      type,
      search: searchParams.get("search") || "",
      category: searchParams.get("category") || "",
      country: searchParams.get("country") || "",
      language: searchParams.get("language") || "",
      inventory_rank: searchParams.get("inventory_rank") || "",
      traffic_quality: searchParams.get("traffic_quality") || "",
      publisher_trust: searchParams.get("publisher_trust") || "",
      min_cpm: searchParams.get("min_cpm") || "",
      max_cpm: searchParams.get("max_cpm") || "",
      min_impressions: searchParams.get("min_impressions") || "",
      leaderboard: searchParams.get("leaderboard") || "",
      trending: searchParams.get("trending") || "",
      featured: searchParams.get("featured") || "",
      limit: Number(searchParams.get("limit") || 48),
    }, user.id);

    return NextResponse.json({ inventory: inventory.map(publicAdvertiserInventory) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load marketplace";
    return NextResponse.json({ error: message }, { status: getAuthErrorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const body = await request.json();
    const inventoryType = normalizeMarketplaceType(body.inventory_type);
    const inventoryId = Number(body.inventory_id);
    const eventType = String(body.event_type || "advertiser_interest");

    if (!Number.isInteger(inventoryId) || inventoryId <= 0) {
      return NextResponse.json({ error: "Invalid inventory" }, { status: 400 });
    }
    if (!["profile_view", "selection", "advertiser_interest"].includes(eventType)) {
      return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    }

    await recordMarketplaceEvent({
      advertiserId: user.id,
      inventoryType,
      inventoryId,
      eventType: eventType as "profile_view" | "selection" | "advertiser_interest",
      metadata: body.metadata || {},
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to track marketplace event";
    return NextResponse.json({ error: message }, { status: getAuthErrorStatus(error) });
  }
}
