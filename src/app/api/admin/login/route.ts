import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import pool from "@/lib/db";
import { createAdminSessionCookieValue } from "@/lib/adminAuth";

type AdminRow = RowDataPacket & {
  id: number;
  username: string;
  password_hash: string | null;
};

function shouldUseSecureCookie(request: Request) {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");

  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return false;
  }

  return url.protocol === "https:" || forwardedProto === "https";
}

function sessionMaxAgeSeconds() {
  const configured = Number.parseInt(process.env.ADMIN_SESSION_TTL_SECONDS || "", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 8 * 60 * 60;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    const [rows] = await pool.query<AdminRow[]>(
      "SELECT id, username, password_hash FROM admins WHERE username = ? LIMIT 1",
      [username]
    );

    if (rows.length === 0 || !rows[0].password_hash) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const passwordValid = await bcrypt.compare(password, rows[0].password_hash);
    if (!passwordValid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const maxAge = sessionMaxAgeSeconds();
    const [sessionResult]: any = await pool.query(
      "INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))",
      [rows[0].id, tokenHash, maxAge]
    );
    const authString = createAdminSessionCookieValue(Number(sessionResult.insertId), token);
    
    const response = NextResponse.json({ success: true });
    response.cookies.set("admin_auth", authString, {
      httpOnly: true,
      secure: shouldUseSecureCookie(request),
      sameSite: "strict",
      maxAge,
      path: "/",
    });

    return response;
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
