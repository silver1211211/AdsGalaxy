import pool from "@/lib/db";
import crypto from "crypto";
import { cookies } from "next/headers";
import type { RowDataPacket } from "mysql2/promise";

type AdminRow = RowDataPacket & {
  id: number;
  username: string;
  role?: string;
};

type SessionRow = AdminRow & {
  session_id: number;
};

export type AdminRole = "super_admin" | "operations_admin" | "support_admin" | "read_only_admin";

const ROLE_PERMISSIONS: Record<AdminRole, Set<string>> = {
  super_admin: new Set(["read", "operate", "dangerous", "support"]),
  operations_admin: new Set(["read", "operate"]),
  support_admin: new Set(["read", "support"]),
  read_only_admin: new Set(["read"]),
};

export function normalizeAdminRole(role: unknown): AdminRole {
  const normalized = String(role || "super_admin").toLowerCase();
  if (normalized === "operations_admin" || normalized === "support_admin" || normalized === "read_only_admin") {
    return normalized;
  }
  return "super_admin";
}

export function adminHasPermission(admin: AdminRow | null, permission: "read" | "operate" | "dangerous" | "support") {
  if (!admin) return false;
  return ROLE_PERMISSIONS[normalizeAdminRole(admin.role)].has(permission);
}

export async function requireAdminPermission(permission: "read" | "operate" | "dangerous" | "support") {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return { admin: null, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!adminHasPermission(admin, permission)) {
    return { admin, response: Response.json({ error: "Forbidden for this admin role" }, { status: 403 }) };
  }
  return { admin, response: null };
}

function getSessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.NEXTAUTH_SECRET || process.env.CRON_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET must be set to at least 32 characters");
  }
  return secret;
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function signSession(sessionId: number, token: string) {
  return crypto.createHmac("sha256", getSessionSecret()).update(`${sessionId}.${token}`).digest("hex");
}

export function createAdminSessionCookieValue(sessionId: number, token: string) {
  return `${sessionId}.${token}.${signSession(sessionId, token)}`;
}

function parseAdminSessionCookie(value: string) {
  const [sessionIdText, token, signature] = String(value || "").split(".");
  const sessionId = Number.parseInt(sessionIdText, 10);
  if (!Number.isInteger(sessionId) || sessionId <= 0 || !token || !signature) return null;

  const expected = signSession(sessionId, token);
  const supplied = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (supplied.length !== expectedBuffer.length || !crypto.timingSafeEqual(supplied, expectedBuffer)) {
    return null;
  }

  return { sessionId, tokenHash: hashToken(token) };
}

export async function checkAdminAuth() {
  return Boolean(await getAuthenticatedAdmin());
}

export async function getAuthenticatedAdmin() {
  const cookieStore = await cookies();
  const adminCookie = await cookieStore.get("admin_auth");
  if (!adminCookie) {
    return null;
  }

  try {
    const session = parseAdminSessionCookie(adminCookie.value);
    if (!session) return null;

    const [rows] = await pool.query<SessionRow[]>(
      `SELECT a.id, a.username, COALESCE(a.role, 'super_admin') as role, s.id as session_id
       FROM admin_sessions s
       JOIN admins a ON a.id = s.admin_id
       WHERE s.id = ?
         AND s.token_hash = ?
         AND s.revoked_at IS NULL
         AND s.expires_at > NOW()
       LIMIT 1`,
      [session.sessionId, session.tokenHash]
    );

    if (rows.length > 0) {
      await pool.query("UPDATE admin_sessions SET last_used_at = NOW() WHERE id = ?", [rows[0].session_id]);
      return rows[0];
    }
  } catch {
    // Session check failed — treat as unauthenticated.
  }

  return null;
}

export async function revokeCurrentAdminSession() {
  const cookieStore = await cookies();
  const adminCookie = await cookieStore.get("admin_auth");
  if (!adminCookie) return false;
  const session = parseAdminSessionCookie(adminCookie.value);
  if (!session) return false;
  await pool.query(
    "UPDATE admin_sessions SET revoked_at = NOW() WHERE id = ? AND token_hash = ? AND revoked_at IS NULL",
    [session.sessionId, session.tokenHash]
  );
  return true;
}
