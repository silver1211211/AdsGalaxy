import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import pool from "@/lib/db";
import { createAdminPreviewCookieValue, createAdminSessionCookieValue, normalizeAdminRole } from "@/lib/adminAuth";
import { clearAdminLoginFailures, inspectAdminLoginRateLimit, recordAdminLoginFailure } from "@/lib/adminLoginProtection";
import { getTrustedClientIp } from "@/lib/requestClientIp";

const INVALID_PASSWORD_HASH = "$2b$12$ws.G8hcWB9cyQmV3vcNvJexJhRPLTb0Xv4D1P.T60HwkrPCKpqeuW";

type AdminRow = RowDataPacket & {
  id: number;
  username: string;
  password_hash: string | null;
  role: string | null;
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

function isPreviewAdminRequest(request: Request) {
  const url = new URL(request.url);
  const forwardedHost = String(request.headers.get("x-forwarded-host") || "").split(",")[0].trim();
  const hostname = (forwardedHost || url.hostname).toLowerCase().replace(/:\d+$/, "");
  return process.env.NODE_ENV !== "production"
    && process.env.ENABLE_LOCAL_MINIAPP_DEV === "true"
    && (hostname === "preview.adsgalaxy.online" || hostname === "localhost" || hostname === "127.0.0.1");
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const clientIp = getTrustedClientIp(request);
    const initialLimit = await inspectAdminLoginRateLimit(username, clientIp);
    if (!initialLimit.available) {
      return NextResponse.json({ error: "Login temporarily unavailable" }, { status: 503 });
    }
    if (initialLimit.limited) {
      return NextResponse.json(
        { error: "Too many login attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(initialLimit.retryAfterMs / 1000))) } },
      );
    }

    const [rows] = await pool.query<AdminRow[]>(
      "SELECT id, username, password_hash, role FROM admins WHERE username = ? LIMIT 1",
      [username]
    );

    const admin = rows[0];
    const passwordValid = await bcrypt.compare(password, admin?.password_hash || INVALID_PASSWORD_HASH);
    const role = normalizeAdminRole(admin?.role);

    if (!admin || !admin.password_hash || !passwordValid || !role) {
      const failedLimit = await recordAdminLoginFailure(username, clientIp);
      if (!failedLimit.available) {
        return NextResponse.json({ error: "Login temporarily unavailable" }, { status: 503 });
      }
      if (failedLimit.limited) {
        return NextResponse.json(
          { error: "Too many login attempts. Try again later." },
          { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(failedLimit.retryAfterMs / 1000))) } },
        );
      }
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    await clearAdminLoginFailures(username, clientIp);

    const maxAge = sessionMaxAgeSeconds();
    let authString: string;
    if (isPreviewAdminRequest(request)) {
      authString = createAdminPreviewCookieValue(admin.id, admin.username, Date.now() + maxAge * 1000);
    } else {
      const token = crypto.randomBytes(32).toString("base64url");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const [sessionResult] = await pool.query<ResultSetHeader>(
        "INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))",
        [admin.id, tokenHash, maxAge]
      );
      authString = createAdminSessionCookieValue(Number(sessionResult.insertId), token);
    }
    
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
