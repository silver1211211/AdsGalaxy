import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";

export async function GET(request: Request) {
  const initData = request.headers.get("x-telegram-init-data");
  const user = await getAuthenticatedUser(initData);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch Click Settlements
    const [clickSettlements]: any = await pool.query(`
      SELECT 
        s.id, 
        s.post_id, 
        s.clicks_count as count, 
        s.publisher_reward as amount, 
        s.created_at, 
        s.status,
        'click' as type,
        c.name as campaign_name,
        ch.username as channel_username
      FROM ad_settlements s
      LEFT JOIN campaigns c ON s.campaign_id = c.id
      LEFT JOIN channels ch ON s.channel_id = ch.id
      WHERE s.publisher_id = ?
      ORDER BY s.created_at DESC
    `, [user.id]);

    // Fetch View Settlements
    const [viewSettlements]: any = await pool.query(`
      SELECT 
        v.id, 
        v.post_id, 
        v.views_count as count, 
        v.publisher_reward as amount, 
        v.created_at, 
        v.status,
        'view' as type,
        c.name as campaign_name,
        ch.username as channel_username
      FROM ad_settlements_views v
      LEFT JOIN campaigns c ON v.campaign_id = c.id
      LEFT JOIN channels ch ON v.channel_id = ch.id
      WHERE v.publisher_id = ?
      ORDER BY v.created_at DESC
    `, [user.id]);

    // Merge and sort
    const allEarnings = [...clickSettlements, ...viewSettlements].sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return NextResponse.json({ earnings: allEarnings });
  } catch (error: any) {
    console.error("Publisher Earnings Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: getAuthErrorStatus(error) });
  }
}
