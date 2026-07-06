import { NextRequest, NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { creditUserAvailableBalance } from "@/lib/earnings";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;
  const lock = await acquireCronLock("settle-broadcast-publishers", 900);
  if (!lock) return NextResponse.json({ success: false, message: "Bot publisher settlement is already running" }, { status: 409 });
  try {
    const [candidates] = await pool.query<Array<RowDataPacket & { id: number }>>(
      "SELECT id FROM broadcast_deliveries WHERE status='sent' AND publisher_reward>0 AND publisher_settled_at IS NULL ORDER BY id LIMIT 1000"
    );
    let settled = 0;
    let publisherCredited = 0;
    for (const candidate of candidates) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [rows] = await conn.query<Array<RowDataPacket & { publisher_reward: string | number; publisher_id: number }>>(`
          SELECT bd.publisher_reward,b.user_id publisher_id FROM broadcast_deliveries bd
          JOIN bots b ON b.id=bd.bot_id
          WHERE bd.id=? AND bd.status='sent' AND bd.publisher_settled_at IS NULL FOR UPDATE`, [candidate.id]);
        const row = rows[0];
        if (!row) { await conn.rollback(); continue; }
        const reward = Math.max(0, Number(row.publisher_reward || 0));
        if (!(await creditUserAvailableBalance(conn, row.publisher_id, reward))) throw new Error("publisher_credit_failed");
        const [updated] = await conn.query<ResultSetHeader>(
          "UPDATE broadcast_deliveries SET publisher_settled_at=NOW() WHERE id=? AND publisher_settled_at IS NULL", [candidate.id]);
        if (updated.affectedRows !== 1) throw new Error("publisher_settlement_race");
        await conn.commit(); settled++; publisherCredited += reward;
      } catch (error) {
        await conn.rollback();
        console.error("Bot publisher settlement failed", { delivery_id: candidate.id, error });
      } finally { conn.release(); }
    }
    return NextResponse.json({ success: true, candidates: candidates.length, settled, publisherCredited: Number(publisherCredited.toFixed(8)) });
  } finally {
    await releaseCronLock(lock);
  }
}
