import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";

export const dynamic = "force-dynamic";

type BotRow = RowDataPacket & { id: number };

function dateRange(request: Request) {
  const params = new URL(request.url).searchParams;
  const requested = Number(params.get("range") || 7);
  const range = Number.isFinite(requested) ? Math.min(30, Math.max(1, requested)) : 7;
  return range;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(request.headers.get("x-telegram-init-data"));
    const { id } = await params;
    const [bots] = await pool.query<BotRow[]>(
      "SELECT id FROM bots WHERE id = ? AND user_id = ? AND is_deleted = FALSE LIMIT 1",
      [id, user.id]
    );
    if (!bots[0]) return NextResponse.json({ error: "Bot not found" }, { status: 404 });

    const range = dateRange(request);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT DATE(created_at) as date,
        FLOOR(COUNT(CASE WHEN status = 'sent' THEN 1 END) / 5) as impressions,
        COALESCE(SUM(CASE WHEN status = 'sent' THEN publisher_reward ELSE 0 END), 0) as earnings,
        COALESCE(SUM(CASE WHEN status = 'sent' THEN cost ELSE 0 END), 0) as spend,
        COALESCE(SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END), 0) as successful_deliveries,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed_deliveries
       FROM broadcast_deliveries
       WHERE bot_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [bots[0].id, range - 1]
    );
    const daily_rows = rows.map((row) => {
      const impressions = Number(row.impressions || 0);
      const earnings = Number(row.earnings || 0);
      const spend = Number(row.spend || 0);
      return { ...row, impressions, earnings, spend, successful_deliveries: Number(row.successful_deliveries || 0), failed_deliveries: Number(row.failed_deliveries || 0), publisher_cpm: impressions > 0 ? earnings / impressions * 1000 : 0, advertiser_cpm: impressions > 0 ? spend / impressions * 1000 : 0 };
    });
    const summary = daily_rows.reduce((total, row) => ({
      impressions: total.impressions + row.impressions,
      earnings: total.earnings + row.earnings,
      spend: total.spend + row.spend,
      successful_deliveries: total.successful_deliveries + row.successful_deliveries,
      failed_deliveries: total.failed_deliveries + row.failed_deliveries,
    }), { impressions: 0, earnings: 0, spend: 0, successful_deliveries: 0, failed_deliveries: 0 });
    return NextResponse.json({ range_days: range, summary: { ...summary, publisher_cpm: summary.impressions > 0 ? summary.earnings / summary.impressions * 1000 : 0, advertiser_cpm: summary.impressions > 0 ? summary.spend / summary.impressions * 1000 : 0 }, daily_rows }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load Bot analytics";
    return NextResponse.json({ error: message }, { status: getAuthErrorStatus(error) });
  }
}
