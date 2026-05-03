import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";

export async function GET() {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [[usersTotal]]: any = await pool.query("SELECT COUNT(*) as count FROM users");
    const [[usersToday]]: any = await pool.query("SELECT COUNT(*) as count FROM users WHERE DATE(created_at) = CURDATE()");
    const [[usersWeek]]: any = await pool.query("SELECT COUNT(*) as count FROM users WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)");
    const [[usersMonth]]: any = await pool.query("SELECT COUNT(*) as count FROM users WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)");

    const [campaignsQuery]: any = await pool.query("SELECT status, COUNT(*) as count FROM campaigns GROUP BY status");
    const campaignsStats = campaignsQuery.reduce((acc: any, row: any) => ({ ...acc, [row.status]: row.count }), {});

    const [channelsQuery]: any = await pool.query("SELECT status, COUNT(*) as count FROM channels GROUP BY status");
    const channelsStats = channelsQuery.reduce((acc: any, row: any) => ({ ...acc, [row.status]: row.count }), {});

    const [withdrawalsQuery]: any = await pool.query("SELECT status, COUNT(*) as count FROM withdrawals GROUP BY status");
    const withdrawalsStats = withdrawalsQuery.reduce((acc: any, row: any) => ({ ...acc, [row.status]: row.count }), {});

    const [[depositsPaid]]: any = await pool.query("SELECT SUM(amount) as total FROM deposits WHERE status IN ('Paid', 'paid', 'success')");
    const [[withdrawalsPaid]]: any = await pool.query("SELECT SUM(amount) as total FROM withdrawals WHERE status = 'success'");

    return NextResponse.json({
      users: {
        total: usersTotal.count,
        today: usersToday.count,
        week: usersWeek.count,
        month: usersMonth.count
      },
      campaigns: {
        pending: campaignsStats.pending || 0,
        active: campaignsStats.active || 0,
        rejected: campaignsStats.rejected || 0,
        paused: campaignsStats.paused || 0,
        total: Object.values(campaignsStats).reduce((a: any, b: any) => a + b, 0)
      },
      channels: {
        pending: channelsStats.pending || 0,
        approved: channelsStats.active || 0,
        rejected: channelsStats.rejected || 0,
        total: Object.values(channelsStats).reduce((a: any, b: any) => a + b, 0)
      },
      withdrawals: {
        pending: withdrawalsStats.pending || 0,
        success: withdrawalsStats.success || 0,
        rejected: withdrawalsStats.rejected || 0,
        total: Object.values(withdrawalsStats).reduce((a: any, b: any) => a + b, 0)
      },
      financials: {
        totalDeposits: depositsPaid.total || 0,
        totalWithdrawals: withdrawalsPaid.total || 0
      }
    });
  } catch (error: any) {
    console.error("Admin Dashboard API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
