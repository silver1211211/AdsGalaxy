import { NextRequest, NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { creditUserLockedBalance } from "@/lib/earnings";

export const dynamic = "force-dynamic";

type DailyStatRow = RowDataPacket & {
  id: number;
  miniapp_id: number;
  user_id: number;
  network_name: string;
  date: string;
  impressions: string | number;
  publisher_revenue: string | number;
};

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

export async function GET(_req: NextRequest) {
  try {
    const [statsToSettle] = await pool.query<DailyStatRow[]>(`
      SELECT
        ds.id,
        ds.miniapp_id,
        m.user_id,
        ds.network_name,
        ds.date,
        ds.impressions,
        ds.publisher_revenue
      FROM miniapp_daily_stats ds
      JOIN miniapps m ON ds.miniapp_id = m.id
      LEFT JOIN miniapp_earnings_settlements s ON s.daily_stat_id = ds.id
      WHERE s.id IS NULL
        AND m.status IN ('approved', 'monetized')
        AND m.is_deleted = FALSE
        AND ds.publisher_revenue > 0
      ORDER BY ds.date ASC, ds.id ASC
      LIMIT 500
    `);

    const conn = await pool.getConnection();
    const results = {
      scanned: statsToSettle.length,
      settled: 0,
      skipped: 0,
      total_locked: 0,
    };

    try {
      for (const stat of statsToSettle) {
        await conn.beginTransaction();

        try {
          const [lockedStats] = await conn.query<DailyStatRow[]>(`
            SELECT
              ds.id,
              ds.miniapp_id,
              m.user_id,
              ds.network_name,
              ds.date,
              ds.impressions,
              ds.publisher_revenue
            FROM miniapp_daily_stats ds
            JOIN miniapps m ON ds.miniapp_id = m.id
            WHERE ds.id = ?
              AND m.status IN ('approved', 'monetized')
              AND m.is_deleted = FALSE
            FOR UPDATE
          `, [stat.id]);

          if (lockedStats.length === 0) {
            await conn.rollback();
            results.skipped++;
            continue;
          }

          const lockedStat = lockedStats[0];
          const publisherRevenue = toNumber(lockedStat.publisher_revenue);

          if (publisherRevenue <= 0) {
            await conn.rollback();
            results.skipped++;
            continue;
          }

          const [insertResult] = await conn.query<ResultSetHeader>(`
            INSERT IGNORE INTO miniapp_earnings_settlements
              (miniapp_id, user_id, daily_stat_id, network_name, date, impressions, publisher_revenue, status, locked_at, unlock_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'locked', NOW(), DATE_ADD(NOW(), INTERVAL 30 DAY))
          `, [
            lockedStat.miniapp_id,
            lockedStat.user_id,
            lockedStat.id,
            lockedStat.network_name,
            lockedStat.date,
            Math.max(0, Math.floor(toNumber(lockedStat.impressions))),
            publisherRevenue,
          ]);

          if (insertResult.affectedRows !== 1) {
            await conn.rollback();
            results.skipped++;
            continue;
          }

          const credited = await creditUserLockedBalance(conn, lockedStat.user_id, publisherRevenue);
          if (!credited) {
            await conn.rollback();
            results.skipped++;
            continue;
          }

          await conn.commit();
          results.settled++;
          results.total_locked += publisherRevenue;
        } catch (error) {
          await conn.rollback();
          results.skipped++;
          console.error("Mini App settlement failed", { daily_stat_id: stat.id, error });
        }
      }
    } finally {
      conn.release();
    }

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error("Mini App Settlement Cron Error:", error);
    return NextResponse.json({ error: error.message || "Mini App settlement failed" }, { status: 500 });
  }
}
