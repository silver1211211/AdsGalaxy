import { NextResponse } from "next/server";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { verifyGrowthDestination } from "@/lib/channelGrowth";

export async function POST(request: Request) {
  try {
    await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const body = await request.json().catch(() => ({}));
    const channel = String(body.channel || "").trim();
    if (!channel) return NextResponse.json({ code: "INVALID_DESTINATION_CHANNEL" }, { status: 400 });
    const verified = await verifyGrowthDestination(channel);
    return NextResponse.json({
      verified: true,
      title: verified.title,
      username: verified.username,
      bot_admin: true,
      can_invite_users: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INVALID_DESTINATION_CHANNEL";
    const code = /invite/i.test(message) ? "BOT_INVITE_PERMISSION_REQUIRED" : /admin/i.test(message) ? "BOT_NOT_ADMIN" : /telegram|timeout|fetch/i.test(message) ? "TELEGRAM_UNAVAILABLE" : "INVALID_DESTINATION_CHANNEL";
    return NextResponse.json({ code }, { status: getAuthErrorStatus(error) === 403 ? 403 : 400 });
  }
}
