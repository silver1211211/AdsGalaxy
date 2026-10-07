import { NextResponse } from "next/server";

export async function POST() {
  const result = NextResponse.json({ success: true });
  result.cookies.set("silver_auth", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", expires: new Date(0) });
  return result;
}
