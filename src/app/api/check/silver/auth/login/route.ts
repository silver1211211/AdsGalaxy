import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { createSilverSessionCookieValue, recordSilverAudit, requireSilverAccessAdmin } from "@/lib/silverCampaignControl";

export async function POST(request: Request) {
  const { admin, response } = await requireSilverAccessAdmin();
  if (response || !admin) return response;
  const [attemptRows] = await pool.query<Array<RowDataPacket & { attempts: number }>>(
    "SELECT COUNT(*) attempts FROM silver_admin_audit_events WHERE admin_id=? AND action='silver_login_failed' AND created_at>=DATE_SUB(NOW(),INTERVAL 15 MINUTE)",
    [admin.id]
  );
  if (Number(attemptRows[0]?.attempts || 0) >= 10) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  const body = await request.json().catch(() => null) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  const [settings] = await pool.query<Array<RowDataPacket & { value: string }>>(
    "SELECT value FROM settings WHERE `key`='silver_admin_password_hash' LIMIT 1"
  );
  const valid = Boolean(settings[0]?.value) && await bcrypt.compare(password, String(settings[0].value));
  if (!valid) {
    await recordSilverAudit({ adminId: admin.id, action: "silver_login_failed" });
    return NextResponse.json({ error: "Invalid Silver password" }, { status: 401 });
  }
  const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  const result = NextResponse.json({ success: true });
  result.cookies.set("silver_auth", createSilverSessionCookieValue(admin.id, expiresAt), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: new Date(expiresAt),
  });
  await recordSilverAudit({ adminId: admin.id, action: "silver_login_success" });
  return result;
}
