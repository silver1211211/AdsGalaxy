import { NextRequest, NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

type SettlementRow = RowDataPacket & {
  id: number;
  user_id: number;
  publisher_revenue: string | number;
  status: string;
};

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

export async function GET(_req: NextRequest) {
  try {
    const [settlements] = await pool.query<SettlementRow[]>(`
      SELECT id, user_id, publisher_revenue, status
      FROM miniapp_earnings_settlements
      WHERE status = 'locked'
        AND unlock_at <= NOW()
        AND publisher_revenue > 0
      ORDER BY unlock_at ASC, id ASC
      LIMIT 500
    `);

    const conn = await pool.getConnection();
    const results = {
      scanned: settlements.length,
      unlocked: 0,
      skipped: 0,
      total_unlocked: 0,
    };

    try {
      for (const settlement of settlements) {
        await conn.beginTransaction();

        try {
          const [lockedRows] = await conn.query<SettlementRow[]>(
            "SELECT id, user_id, publisher_revenue, status FROM miniapp_earnings_settlements WHERE id = ? FOR UPDATE",
            [settlement.id]
          );

          if (lockedRows.length === 0 || lockedRows[0].status !== "locked") {
            await conn.rollback();
            results.skipped++;
            continue;
          }

          const lockedSettlement = lockedRows[0];
          const amount = toNumber(lockedSettlement.publisher_revenue);

          if (amount <= 0) {
            await conn.rollback();
            results.skipped++;
            continue;
          }

          const [balanceResult] = await conn.query<ResultSetHeader>(
            `UPDATE users
             SET balance_locked = balance_locked - ?,
                 balance_available = balance_available + ?
             WHERE id = ?
               AND balance_locked >= ?`,
            [amount, amount, lockedSettlement.user_id, amount]
          );

          if (balanceResult.affectedRows !== 1) {
            await conn.rollback();
            results.skipped++;
            continue;
          }

          const [settlementResult] = await conn.query<ResultSetHeader>(
            "UPDATE miniapp_earnings_settlements SET status = 'unlocked', unlocked_at = NOW() WHERE id = ? AND status = 'locked'",
            [lockedSettlement.id]
          );

          if (settlementResult.affectedRows !== 1) {
            await conn.rollback();
            results.skipped++;
            continue;
          }

          await conn.commit();
          results.unlocked++;
          results.total_unlocked += amount;
        } catch (error) {
          await conn.rollback();
          results.skipped++;
          console.error("Mini App unlock failed", { settlement_id: settlement.id, error });
        }
      }
    } finally {
      conn.release();
    }

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error("Mini App Unlock Cron Error:", error);
    return NextResponse.json({ error: error.message || "Mini App unlock failed" }, { status: 500 });
  }
}
