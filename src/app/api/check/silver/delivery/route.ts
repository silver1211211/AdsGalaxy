import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { recordSilverAudit, requireSilverAdmin } from "@/lib/silverCampaignControl";

export async function GET() {
  const { response } = await requireSilverAdmin();
  if (response) return response;
  const [rows] = await pool.query<Array<RowDataPacket & { value: string }>>("SELECT value FROM settings WHERE `key`='silver_delivery_enabled' LIMIT 1");
  return NextResponse.json({ enabled: String(rows[0]?.value || "true").toLowerCase() === "true" });
}

export async function PATCH(request: Request) {
  const { admin, response } = await requireSilverAdmin();
  if (response) return response;
  const { enabled } = await request.json();
  if (typeof enabled !== "boolean") return NextResponse.json({ error: "enabled must be boolean" }, { status: 400 });
  await pool.query("INSERT INTO settings(`key`,`value`,`description`) VALUES('silver_delivery_enabled',?,'Master delivery guard for Silver-managed campaigns only') ON DUPLICATE KEY UPDATE value=VALUES(value)", [enabled ? "true" : "false"]);
  await recordSilverAudit({ adminId: admin?.id, action: enabled ? "silver_delivery_resume" : "silver_delivery_pause" });
  return NextResponse.json({ success: true, enabled });
}
