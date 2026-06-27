import { NextResponse } from "next/server";
import { revokeCurrentAdminSession } from "@/lib/adminAuth";

function shouldUseSecureCookie(request: Request) {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return false;
  return url.protocol === "https:" || forwardedProto === "https";
}

export async function POST(request: Request) {
  await revokeCurrentAdminSession();
  const response = NextResponse.json({ success: true });
  response.cookies.set("admin_auth", "", {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "strict",
    maxAge: 0,
    path: "/",
  });
  return response;
}
