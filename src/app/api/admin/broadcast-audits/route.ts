import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";

export async function GET(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "10");
  const offset = (page - 1) * limit;
  const search = searchParams.get("search") || "";

  try {
    let whereClause = "WHERE c.type = 'broadcast'";
    const params: any[] = [];

    if (search) {
      whereClause += " AND (c.name LIKE ? OR u.username LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    const [campaigns]: any = await pool.query(`
      SELECT c.*, u.username as owner_username,
      (SELECT COUNT(*) FROM broadcast_deliveries WHERE campaign_id = c.id) as delivery_count,
      (SELECT SUM(cost) FROM broadcast_deliveries WHERE campaign_id = c.id) as total_spent,
      (SELECT SUM(publisher_reward) FROM broadcast_deliveries WHERE campaign_id = c.id) as total_rewards
      FROM campaigns c
      JOIN users u ON c.user_id = u.id
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const [[countRow]]: any = await pool.query(`
      SELECT COUNT(*) as total FROM campaigns c
      JOIN users u ON c.user_id = u.id
      ${whereClause}
    `, params);

    return NextResponse.json({
      campaigns: campaigns.map((c: any) => ({
        ...c,
        delivery_count: parseInt(c.delivery_count || "0"),
        total_spent: parseFloat(c.total_spent || "0"),
        total_rewards: parseFloat(c.total_rewards || "0")
      })),
      total: countRow.total,
      page,
      totalPages: Math.ceil(countRow.total / limit),
    });
  } catch (error: any) {
    console.error("Admin Broadcast Audits API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
