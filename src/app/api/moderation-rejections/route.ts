import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { getOwnerRejection, type ModerationEntityType } from "@/lib/moderationRejections";

const CONFIG: Record<ModerationEntityType, { table: string; owner: string }> = {
  channel: { table: "channels", owner: "user_id" }, bot: { table: "bots", owner: "user_id" }, miniapp: { table: "miniapps", owner: "user_id" },
  campaign: { table: "campaigns", owner: "user_id" }, miniapp_rewarded_campaign: { table: "miniapp_rewarded_campaigns", owner: "advertiser_id" },
};
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"), { request });
    const q = new URL(request.url).searchParams; const type = String(q.get("entity_type") || "") as ModerationEntityType; const id = Number(q.get("entity_id")); const cfg = CONFIG[type];
    if (!cfg || !Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "ENTITY_NOT_FOUND" }, { status: 404 });
    const [rows] = await pool.query<Array<import("mysql2/promise").RowDataPacket & { status: string }>>(`SELECT status FROM ${cfg.table} WHERE id=? AND ${cfg.owner}=? LIMIT 1`, [id, user.id]);
    if (!rows[0]) return NextResponse.json({ error: "ENTITY_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ rejection: await getOwnerRejection(type, id, Number(user.id), rows[0].status) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: "Unauthorized" }, { status: getAuthErrorStatus(error) }); }
}
