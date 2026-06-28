import { NextResponse } from "next/server";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    await getAuthenticatedUser(initData);

    const { searchParams } = new URL(request.url);
    const username = searchParams.get("username")?.trim();
    if (!username) {
      return NextResponse.json({ error: "username is required" }, { status: 400 });
    }

    const token = process.env.BOT_TOKEN;
    if (!token) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const chatId = username.startsWith("@") ? username : `@${username}`;

    const res = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId }),
    });
    const data = await res.json();

    if (!data.ok) {
      return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    }

    const chat = data.result;
    return NextResponse.json({
      id: chat.id,
      username: chat.username,
      first_name: chat.first_name,
    });
  } catch (error: any) {
    console.error("Verify bot error:", error);
    const status = getAuthErrorStatus(error);
    return NextResponse.json(
      { error: status === 403 ? "Unauthorized" : "Verification failed" },
      { status }
    );
  }
}
