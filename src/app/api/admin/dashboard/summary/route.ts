import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";
import { CACHE_TTL_SECONDS, cacheGetOrSet, cacheSet, redisKeys } from "@/lib/redisCache";

export async function GET(request: Request) {
  const forceFresh = new URL(request.url).searchParams.get("fresh") === "1";
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = await cacheGetOrSet(
      redisKeys.adminDashboardSummary(),
      CACHE_TTL_SECONDS.ADMIN_DASHBOARD_SUMMARY,
      async () => {
    const [usersResult, campaignsResult, withdrawalsResult, depositsResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total,
        SUM(created_at >= CURDATE()) AS today,
        SUM(created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)) AS week,
        SUM(created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) AS month FROM users`),
      pool.query("SELECT status, COUNT(*) AS count FROM campaigns GROUP BY status"),
      pool.query("SELECT status, COUNT(*) AS count FROM withdrawals GROUP BY status"),
      pool.query("SELECT status, COUNT(*) AS count FROM deposits GROUP BY status"),
    ]);

    const user = (usersResult[0] as Array<Record<string, unknown>>)[0] || {};
    const toStatusMap = (rows: unknown) => Object.fromEntries(
      (rows as Array<{ status: string; count: number }>).map((row) => [row.status, Number(row.count || 0)]),
    );

    return {
      users: {
        total: Number(user.total || 0),
        today: Number(user.today || 0),
        week: Number(user.week || 0),
        month: Number(user.month || 0),
      },
      campaigns: toStatusMap(campaignsResult[0]),
      withdrawals: toStatusMap(withdrawalsResult[0]),
      deposits: toStatusMap(depositsResult[0]),
    };
      },
      { bypass: forceFresh },
    );
    if (forceFresh) {
      await cacheSet(redisKeys.adminDashboardSummary(), payload, CACHE_TTL_SECONDS.ADMIN_DASHBOARD_SUMMARY);
    }
    return NextResponse.json(payload, {
      headers: forceFresh
        ? { "Cache-Control": "private, no-store, max-age=0", "X-AdsGalaxy-Cache": "REFRESH" }
        : { "Cache-Control": "private, max-age=12, stale-while-revalidate=60" },
    });
  } catch (error) {
    console.error("Admin dashboard summary failed", { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Unable to load dashboard summary" }, { status: 500 });
  }
}
