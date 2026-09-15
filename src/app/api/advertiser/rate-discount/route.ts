import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { getAdvertiserDiscount } from "@/lib/advertiserDiscount";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    return NextResponse.json(await getAdvertiserDiscount(pool, user.id), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json({ error: "Unable to load advertiser discount" }, { status: getAuthErrorStatus(error) });
  }
}
