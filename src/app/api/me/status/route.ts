import { NextResponse } from "next/server";
import { getAuthenticatedUserStatus } from "@/lib/auth";
import { resolveUserLocale } from "@/lib/userLocale";

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUserStatus(initData, { request });

    const language = resolveUserLocale(user.language);
    const response = NextResponse.json({
      id: user.id,
      status: user.status || "active",
      is_banned: String(user.status || "").toLowerCase() === "banned",
      banned_at: user.banned_at || null,
      ban_reason: user.ban_reason || null,
      language,
      ad_balance: Number(user.ad_balance || 0),
      balance_available: Number(user.balance_available || 0),
      balance_locked: Number(user.balance_locked || 0),
      advertiser_balance_locked: Number(user.advertiser_balance_locked || 0),
    });
    response.cookies.set("ag_locale", language, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 365 * 24 * 60 * 60,
      path: "/",
    });
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
