import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { refreshTrafficQualitySnapshots } from "@/lib/trafficQualityRefresh";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const unauthorized = requireCronSecret(req);
  if (unauthorized) return unauthorized;

  const lock = await acquireCronLock("traffic-quality", 1800);
  if (!lock) {
    return NextResponse.json({ success: false, message: "Traffic quality cron is already running" }, { status: 409 });
  }

  try {
    const isDev = process.env.MODE === "DEV";
    const now = Date.now();
    const intervalMinutes = parseInt(process.env.CRON_TRAFFIC_QUALITY_INTERVAL || "60");
    const intervalMs = intervalMinutes * 60 * 1000;

    await pool.query(
      "INSERT IGNORE INTO settings (`key`, value, description) VALUES ('last_traffic_quality_cron_run', '0', 'Timestamp of last traffic quality cron run')"
    );
    const [throttleResult]: any = await pool.query(
      `UPDATE settings
       SET value = ?
       WHERE \`key\` = 'last_traffic_quality_cron_run'
         AND (CAST(value AS UNSIGNED) <= ? OR ? = 1)`,
      [now.toString(), String(now - intervalMs), isDev ? 1 : 0]
    );

    if (throttleResult.affectedRows !== 1) {
      const minutesLeft = intervalMinutes;
      return NextResponse.json({
        success: false,
        message: `Too early. Please wait ${minutesLeft} more minutes.`,
      }, { status: 429 });
    }

    const limit = Number(req.nextUrl.searchParams.get("limit") || process.env.CRON_TRAFFIC_QUALITY_LIMIT || 200);
    const refreshed = await refreshTrafficQualitySnapshots(limit);

    return NextResponse.json({
      success: true,
      refreshed,
    });
  } catch (error: any) {
    console.error("Traffic quality cron error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
