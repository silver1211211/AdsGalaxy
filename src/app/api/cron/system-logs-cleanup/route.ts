import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { cleanupOldSystemLogs, createSystemLog } from "@/lib/systemLogs";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const lock = await acquireCronLock("system-logs-cleanup", 1800);
  if (!lock) {
    return NextResponse.json({ success: false, message: "System logs cleanup cron is already running" }, { status: 409 });
  }

  try {
    const isDev = process.env.MODE === "DEV";
    const now = Date.now();
    const intervalMs = 24 * 60 * 60 * 1000;

    await pool.query(
      "INSERT IGNORE INTO settings (`key`, value, description) VALUES ('last_system_logs_cleanup_run', '0', 'Timestamp of last system logs cleanup cron run')"
    );
    const [throttleResult]: any = await pool.query(
      `UPDATE settings
       SET value = ?
       WHERE \`key\` = 'last_system_logs_cleanup_run'
         AND (CAST(value AS UNSIGNED) <= ? OR ? = 1)`,
      [now.toString(), String(now - intervalMs), isDev ? 1 : 0]
    );

    if (throttleResult.affectedRows !== 1) {
      return NextResponse.json({ success: false, message: "Too early" }, { status: 429 });
    }

    const result = await cleanupOldSystemLogs();

    await createSystemLog({
      logType: "system_error",
      status: "success",
      title: "System log cleanup completed",
      summary: `Deleted ${result.deleted} logs older than ${result.retentionDays} days.`,
      successCount: 1,
      metadata: result,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    console.error("System Logs Cleanup Error:", error);
    await createSystemLog({
      logType: "system_error",
      status: "failed",
      title: "System log cleanup failed",
      summary: error?.message || "System log cleanup failed.",
      failedCount: 1,
      failureReasons: { system_error: 1 },
      metadata: { route: "/api/cron/system-logs-cleanup" },
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
