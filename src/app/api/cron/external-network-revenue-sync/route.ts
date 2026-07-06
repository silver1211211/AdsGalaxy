/* eslint-disable @typescript-eslint/no-explicit-any -- cron throttle query returns driver-specific metadata */
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import { runExternalNetworkRevenueReconciliation } from "@/lib/externalNetworkRevenueReconciliation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;
  const lock = await acquireCronLock("external-network-revenue-sync", 1800);
  if (!lock) return NextResponse.json({ success: false, message: "External network sync is already running" }, { status: 409 });
  try {
    const isDev = process.env.MODE === "DEV";
    const now = Date.now();
    const intervalMinutes = Math.max(60, parseInt(process.env.CRON_EXTERNAL_NETWORK_REVENUE_SYNC_INTERVAL || "60", 10) || 60);
    const intervalMs = intervalMinutes * 60 * 1000;

    await pool.query(
      "INSERT IGNORE INTO settings (`key`, value, description) VALUES ('last_external_network_revenue_sync_run', '0', 'Timestamp of last external network revenue reconciliation cron run')"
    );
    const [throttleResult]: any = await pool.query(
      `UPDATE settings
       SET value = ?
       WHERE \`key\` = 'last_external_network_revenue_sync_run'
         AND (CAST(value AS UNSIGNED) <= ? OR ? = 1)`,
      [now.toString(), String(now - intervalMs), isDev ? 1 : 0]
    );

    if (throttleResult.affectedRows !== 1) {
      return NextResponse.json({ success: false, message: `Too early. External revenue sync runs every ${intervalMinutes} minutes.` }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const result = await runExternalNetworkRevenueReconciliation({
      sinceDate: searchParams.get("since") || undefined,
      untilDate: searchParams.get("until") || undefined,
    });
    return NextResponse.json(result);
  } finally {
    await releaseCronLock(lock);
  }
}
