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
  const statusFilter = searchParams.get("status") || "all";
  const search = searchParams.get("search") || "";
  const offset = (page - 1) * limit;

  try {
    let query = `
      SELECT c.*, u.first_name, u.last_name, u.username, u.telegram_id 
      FROM campaigns c 
      LEFT JOIN users u ON c.user_id = u.id
    `;
    let countQuery = "SELECT COUNT(*) as total FROM campaigns c LEFT JOIN users u ON c.user_id = u.id";
    const queryParams: any[] = [];

    let whereClause = " WHERE 1=1";

    if (statusFilter !== "all") {
      whereClause += " AND c.status = ?";
      queryParams.push(statusFilter);
    }

    if (search) {
      whereClause += ` AND (
        c.name LIKE ? OR 
        c.message_text LIKE ? OR 
        u.first_name LIKE ? OR 
        u.last_name LIKE ? OR 
        u.username LIKE ? OR 
        u.telegram_id LIKE ?
      )`;
      const searchVal = `%${search}%`;
      queryParams.push(searchVal, searchVal, searchVal, searchVal, searchVal, searchVal);
    }

    query += whereClause + " ORDER BY c.id DESC LIMIT ? OFFSET ?";
    countQuery += whereClause;
    
    const [rows]: any = await pool.query(query, [...queryParams, limit, offset]);
    const [[countRow]]: any = await pool.query(countQuery, queryParams);

    return NextResponse.json({
      campaigns: rows,
      total: countRow.total,
      page,
      totalPages: Math.ceil(countRow.total / limit),
    });
  } catch (error: any) {
    console.error("Admin Campaigns API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, action } = await request.json();

    if (action === "reject") {
      await pool.query("UPDATE campaigns SET status = 'rejected' WHERE id = ?", [id]);
      return NextResponse.json({ success: true });
    }

    if (action === "approve") {
      await pool.query("UPDATE campaigns SET status = 'active' WHERE id = ?", [id]);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    console.error("Admin Campaigns Update Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
