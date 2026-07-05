/* eslint-disable @typescript-eslint/no-explicit-any -- cron responses include legacy aggregate payloads */
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import { runMiniAppRevenueOptimizer } from "@/lib/miniappRevenueOptimizer";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  const lock = await acquireCronLock("miniapp-revenue-optimizer", 1800);
  if (!lock) {
    return NextResponse.json({ success: false, message: "Mini App revenue optimizer cron is already running" }, { status: 409 });
  }

  try {
    const isDev = process.env.MODE === "DEV";
    const now = Date.now();
    const intervalMinutes = Math.max(60, parseInt(process.env.CRON_MINIAPP_REVENUE_OPTIMIZER_INTERVAL || "60", 10) || 60);
    const intervalMs = intervalMinutes * 60 * 1000;

    await pool.query(
      "INSERT IGNORE INTO settings (`key`, value, description) VALUES ('last_miniapp_revenue_optimizer_run', '0', 'Timestamp of last Mini App revenue optimizer cron run')"
    );
    const [throttleResult]: any = await pool.query(
      `UPDATE settings
       SET value = ?
       WHERE \`key\` = 'last_miniapp_revenue_optimizer_run'
         AND (CAST(value AS UNSIGNED) <= ? OR ? = 1)`,
      [now.toString(), String(now - intervalMs), isDev ? 1 : 0]
    );

    if (throttleResult.affectedRows !== 1) {
      return NextResponse.json({ success: false, message: `Too early. Optimizer runs every ${intervalMinutes} minutes.` }, { status: 429 });
    }

    const result = await runMiniAppRevenueOptimizer({ triggeredBy: "cron" });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Mini App revenue optimizer cron error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
