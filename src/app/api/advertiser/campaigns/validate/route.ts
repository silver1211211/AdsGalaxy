import { NextResponse } from "next/server";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { sendTelegramMessage } from "@/lib/telegram";

export async function POST(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    const contentType = request.headers.get("content-type") || "";
    let text, parse_mode, link, button_text, image;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      text = formData.get("text") as string;
      parse_mode = formData.get("parse_mode") as string;
      link = formData.get("link") as string;
      button_text = formData.get("button_text") as string;
      image = formData.get("image") as File;
    } else {
      const body = await request.json();
      text = body.text;
      parse_mode = body.parse_mode;
      link = body.link;
      button_text = body.button_text;
    }

    if (!text) {
      return NextResponse.json({ error: "Message text is required" }, { status: 400 });
    }

    const botUsername = process.env.TELEGRAM_BOT_USERNAME || process.env.NEXT_PUBLIC_BOT_USERNAME || "Ads_Galaxy_bot";
    const advertiseUrl = `https://t.me/${botUsername}?start=advertise`;
    const reply_markup = {
      inline_keyboard: [
        [{ text: button_text || "Click Here", url: link || `https://t.me/${botUsername}` }],
        [{ text: "Advertise with Ads galaxy", url: advertiseUrl }]
      ]
    };

    // If image is provided as a File, we need to handle it. 
    // Telegram API can take a file or a URL. 
    // In validation, we might just send the file directly if it's small.
    let photoData = null;
    if (image) {
      const arrayBuffer = await image.arrayBuffer();
      photoData = Buffer.from(arrayBuffer);
    }

    const result = await sendTelegramMessage(user.telegram_id, text, {
      parse_mode: parse_mode === "none" ? undefined : (parse_mode === "html" ? "HTML" : "MarkdownV2"),
      reply_markup,
      ...(photoData && { photo: photoData })
    });

    if (!result || !result.ok) {
      return NextResponse.json({ 
        error: "Validation failed: " + (result?.description || "Invalid formatting or assets"),
        details: result
      }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: "Validation message sent to your Telegram!" });
  } catch (error: any) {
    console.error("Validation API Error:", error);
    return NextResponse.json({ error: error.message || "Internal validation error" }, { status: getAuthErrorStatus(error) });
  }
}
