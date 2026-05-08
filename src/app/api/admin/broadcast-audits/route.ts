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
    let whereClause = "";
    const params: any[] = [];

    if (search) {
      whereClause = "WHERE c.name LIKE ? OR b.bot_name LIKE ? OR bd.chat_id LIKE ?";
      const searchVal = `%${search}%`;
      params.push(searchVal, searchVal, searchVal);
    }

    const [deliveries]: any = await pool.query(`
      SELECT bd.*, c.name as campaign_name, b.bot_name, u.username as publisher_username
      FROM broadcast_deliveries bd
      JOIN campaigns c ON bd.campaign_id = c.id
      JOIN bots b ON bd.bot_id = b.id
      JOIN users u ON b.user_id = u.id
      ${whereClause}
      ORDER BY bd.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const [[countRow]]: any = await pool.query(`
      SELECT COUNT(*) as total 
      FROM broadcast_deliveries bd
      JOIN campaigns c ON bd.campaign_id = c.id
      JOIN bots b ON bd.bot_id = b.id
      ${whereClause}
    `, params);

    return NextResponse.json({
      deliveries,
      total: countRow.total,
      page,
      totalPages: Math.ceil(countRow.total / limit),
    });
  } catch (error: any) {
    console.error("Admin Broadcast Audits API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
