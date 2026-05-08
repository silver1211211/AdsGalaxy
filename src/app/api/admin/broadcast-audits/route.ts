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
      SELECT bd.*, 
        c.name as campaign_name, c.parse_mode, c.message_text, c.image_url, c.link, c.button_text, c.type as campaign_type, c.budget as campaign_budget, c.cpm as campaign_cpm, c.category as campaign_category, c.continents as campaign_continents, c.status as campaign_status,
        b.bot_name, b.bot_username, b.bot_token, b.status as bot_status, b.posts_per_day, b.categories as bot_categories, b.continents as bot_continents,
        u_adv.first_name as adv_first_name, u_adv.last_name as adv_last_name, u_adv.username as adv_username, u_adv.telegram_id as adv_telegram_id,
        u_pub.username as publisher_username, u_pub.first_name as pub_first_name, u_pub.last_name as pub_last_name, u_pub.telegram_id as pub_telegram_id
      FROM broadcast_deliveries bd
      JOIN campaigns c ON bd.campaign_id = c.id
      JOIN bots b ON bd.bot_id = b.id
      JOIN users u_adv ON c.user_id = u_adv.id
      JOIN users u_pub ON b.user_id = u_pub.id
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
