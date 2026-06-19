import pool from "@/lib/db";
import { cookies } from "next/headers";
import type { RowDataPacket } from "mysql2/promise";

type AdminRow = RowDataPacket & {
  id: number;
  username: string;
};

function decodeBase64(value: string) {
  return Buffer.from(value, "base64").toString("utf-8");
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return decodeBase64(padded);
}

function decodeAdminCookie(value: string) {
  const candidates = new Set<string>([value]);

  try {
    candidates.add(decodeURIComponent(value));
  } catch {
    // Keep the raw cookie candidate when it is not URI encoded.
  }

  for (const candidate of candidates) {
    for (const decode of [decodeBase64Url, decodeBase64]) {
      try {
        const decoded = decode(candidate);
        const separatorIndex = decoded.indexOf(":");

        if (separatorIndex <= 0) continue;

        return {
          username: decoded.slice(0, separatorIndex),
          password: decoded.slice(separatorIndex + 1),
        };
      } catch {
        // Try the next encoding/candidate pair.
      }
    }
  }

  return null;
}

export async function checkAdminAuth() {
  const cookieStore = await cookies();
  const adminCookie = await cookieStore.get("admin_auth");
  console.info("Admin auth check", { cookie_exists: !!adminCookie });

  if (!adminCookie) {
    return false;
  }

  try {
    const credentials = decodeAdminCookie(adminCookie.value);
    if (!credentials) {
      console.warn("Admin auth cookie decode failed");
      return false;
    }

    const { username, password } = credentials;
    console.info("Admin auth decoded", { username });

    const [rows] = await pool.query<AdminRow[]>(
      "SELECT id, username FROM admins WHERE username = ? AND password = ?",
      [username, password]
    );
    console.info("Admin auth database match", { username, matched: rows.length > 0 });

    if (rows.length > 0) {
      return true;
    }
  } catch (error: unknown) {
    console.error("Admin auth check error:", error);
  }

  return false;
}
