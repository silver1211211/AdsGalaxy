import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData, { allowBanned: true });

    return NextResponse.json({
      id: user.id,
      status: user.status || "active",
      is_banned: String(user.status || "").toLowerCase() === "banned",
      miniapp_beta_access: true,
      banned_at: user.banned_at || null,
      ban_reason: user.ban_reason || null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
