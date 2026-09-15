import { NextResponse } from "next/server";
import { getAuthenticatedUserStatus } from "@/lib/auth";
import { isLocale } from "@/i18n";
import { resolveUserLocale, setUserLocale } from "@/lib/userLocale";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUserStatus(request.headers.get("x-telegram-init-data"), { request });
    return NextResponse.json({ language: resolveUserLocale(user.language) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUserStatus(request.headers.get("x-telegram-init-data"), { request });
    const body = await request.json().catch(() => ({}));
    if (!isLocale(body.language)) {
      return NextResponse.json({ error: "Invalid language" }, { status: 400 });
    }
    await setUserLocale(Number(user.id), body.language);
    const response = NextResponse.json({ language: body.language });
    response.cookies.set("ag_locale", body.language, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 365 * 24 * 60 * 60,
      path: "/",
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unauthorized" },
      { status: 401 },
    );
  }
}
