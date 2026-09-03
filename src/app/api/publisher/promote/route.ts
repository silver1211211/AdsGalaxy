import { NextResponse } from "next/server";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { getPromoteSummary, savePromoteWallet } from "@/lib/promoteAdsGalaxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"), { request });
    const summary = await getPromoteSummary(Number(user.id));
    if (!summary) return NextResponse.json({ error: "Campaign unavailable" }, { status: 404 });
    return NextResponse.json(summary, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: getAuthErrorStatus(error) === 403 ? 403 : 401 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"), { request });
    const body = await request.json();
    return NextResponse.json(await savePromoteWallet(Number(user.id), String(body.network || ""), String(body.address || "").trim()), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save wallet";
    const status = message === "wallet_locked" ? 423 : ["invalid_wallet", "wallet_not_open"].includes(message) ? 400 : getAuthErrorStatus(error) === 403 ? 403 : 401;
    return NextResponse.json({ error: message === "wallet_locked" ? "Wallet updates are locked" : message === "wallet_not_open" ? "Wallet saving opens when the campaign starts" : message === "invalid_wallet" ? "Enter a valid BEP-20 wallet address" : message }, { status });
  }
}
