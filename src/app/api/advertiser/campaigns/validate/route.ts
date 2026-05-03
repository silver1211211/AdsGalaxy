import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    const { text, parse_mode } = await request.json();

    if (!text) {
      return NextResponse.json({ error: "Message text is required" }, { status: 400 });
    }

    const botToken = process.env.BOT_TOKEN;
    
    // Attempt to send message to user for validation
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: user.telegram_id,
        text: text,
        ...(parse_mode !== "none" && { 
          parse_mode: parse_mode === "html" ? "HTML" : "MarkdownV2" 
        }),
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      return NextResponse.json({ 
        error: "Validation failed: " + (result.description || "Invalid formatting"),
        details: result
      }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: "Validation message sent to your Telegram!" });
  } catch (error: any) {
    console.error("Validation API Error:", error);
    return NextResponse.json({ error: error.message || "Internal validation error" }, { status: 500 });
  }
}
