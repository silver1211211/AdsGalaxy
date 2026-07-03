import { NextResponse } from "next/server";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { listMarketplaceInventory, normalizeMarketplaceType } from "@/lib/publisherMarketplace";
import { publicAdvertiserInventory } from "@/lib/advertiserResponsePrivacy";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const { searchParams } = new URL(request.url);
    const typeParam = searchParams.get("type") || "all";
    const type = typeParam === "all" ? "all" : normalizeMarketplaceType(typeParam);
    const category = searchParams.get("category") || "";
    const country = (searchParams.get("countries") || "").split(",").map((item) => item.trim()).filter(Boolean)[0] || "";
    const language = (searchParams.get("languages") || "").split(",").map((item) => item.trim()).filter(Boolean)[0] || "";
    const budget = Number(searchParams.get("budget") || 0);

    const inventory = await listMarketplaceInventory({
      type,
      category,
      country,
      language,
      publisher_trust: budget >= 100 ? "advanced" : "",
      limit: 9,
    }, user.id);

    return NextResponse.json({ inventory: inventory.map(publicAdvertiserInventory) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load recommended inventory";
    return NextResponse.json({ error: message }, { status: getAuthErrorStatus(error) });
  }
}
