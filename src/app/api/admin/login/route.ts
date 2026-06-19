import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

type AdminRow = RowDataPacket & {
  id: number;
  username: string;
};

function encodeAdminCookie(username: string, password: string) {
  return Buffer.from(`${username}:${password}`, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function shouldUseSecureCookie(request: Request) {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");

  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return false;
  }

  return url.protocol === "https:" || forwardedProto === "https";
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    console.info("Admin login attempt", { username });

    const [rows] = await pool.query<AdminRow[]>(
      "SELECT id, username FROM admins WHERE username = ? AND password = ?",
      [username, password]
    );
    console.info("Admin login database match", { username, matched: rows.length > 0 });

    if (rows.length === 0) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const authString = encodeAdminCookie(rows[0].username, password);
    
    const response = NextResponse.json({ success: true });
    response.cookies.set("admin_auth", authString, {
      httpOnly: false,
      secure: shouldUseSecureCookie(request),
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: "/",
    });
    console.info("Admin login cookie set", { username: rows[0].username });

    return response;
  } catch (error: unknown) {
    console.error("Admin Login Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
