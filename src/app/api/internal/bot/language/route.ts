import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { buildBotLanguageSelector, buildBotStartPayload } from "@/lib/botLocalization";
import { ensureTelegramUserForReferral } from "@/lib/referralAttribution";
import { escapeTelegramHtml } from "@/lib/telegram";
import { isLocale } from "@/i18n";
import { setUserLocale } from "@/lib/userLocale";

function authorized(request: Request) {
  const expected = process.env.BOT_TOKEN || "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length > 0
    && expectedBuffer.length === suppliedBuffer.length
    && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const user = await ensureTelegramUserForReferral({
      id: body.telegram_id,
      first_name: body.first_name,
      last_name: body.last_name,
      username: body.username,
    });

    if (body.action === "selector") {
      return NextResponse.json(buildBotLanguageSelector());
    }

    if (body.action !== "select" || !isLocale(body.language)) {
      return NextResponse.json({ error: "Invalid language" }, { status: 400 });
    }

    await setUserLocale(Number(user.id), body.language);
    return NextResponse.json(buildBotStartPayload(
      body.language,
      escapeTelegramHtml(body.first_name || "User"),
      body.private_chat !== false,
    ));
  } catch (error) {
    console.error("Bot language request failed", error instanceof Error ? error.message : "unknown_error");
    return NextResponse.json({ error: "Language request failed" }, { status: 500 });
  }
}
