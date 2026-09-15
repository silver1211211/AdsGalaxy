import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { audit } from "@/lib/platformBroadcast";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { admin, response } = await requireAdminPermission("dangerous");
  if (response) return response;
  const id = Number((await context.params).id);
  const body = await request.json().catch(() => ({}));
  if (!Number.isInteger(id) || id <= 0 || body.confirm !== `RECALL-${id}`) {
    return NextResponse.json({ error: "Exact broadcast recall confirmation is required." }, { status: 400 });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[broadcast]]: any = await conn.query("SELECT id,title,status FROM platform_broadcasts WHERE id=? FOR UPDATE", [id]);
    if (!broadcast) { await conn.rollback(); return NextResponse.json({ error: "Broadcast not found." }, { status: 404 }); }
    await conn.query("UPDATE platform_broadcasts SET status='cancelled' WHERE id=?", [id]);
    await conn.query("UPDATE platform_broadcast_recipients SET status='cancelled' WHERE broadcast_id=? AND status IN ('queued','sending')", [id]);
    const [queued]: any = await conn.query(
      `UPDATE platform_broadcast_recipients SET deletion_status='delete_pending',deletion_next_retry_at=NOW(),deletion_error=NULL
       WHERE broadcast_id=? AND status='sent' AND telegram_message_id IS NOT NULL
         AND (deletion_status IS NULL OR deletion_status IN ('delete_failed','not_found'))`, [id]);
    await conn.commit();
    await audit(id, "recall_requested", admin!.id, { targeted: Number(queued.affectedRows || 0) });
    return NextResponse.json({ id, status: "cancelled", targeted: Number(queued.affectedRows || 0) }, { status: 202 });
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    console.error("Platform broadcast recall failed", { broadcast_id: id, error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Could not schedule recall." }, { status: 500 });
  } finally { conn.release(); }
}
