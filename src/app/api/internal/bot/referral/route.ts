import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { attributeReferral, ensureTelegramUserForReferral } from "@/lib/referralAttribution";

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
    const result = await attributeReferral({
      userId: Number(user.id),
      token: body.referral_token,
      // Persist first-touch attribution in the bounded internal request. Device
      // fraud signals and reward finalization run through normal Mini App auth,
      // which is idempotent and has the actual request/device context.
      deferFinalization: true,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Bot referral attribution failed:", error instanceof Error ? error.message : "unknown_error");
    return NextResponse.json({ error: "Referral attribution failed" }, { status: 500 });
  }
}
