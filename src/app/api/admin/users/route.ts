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
  const search = searchParams.get("search") || "";
  const offset = (page - 1) * limit;

  try {
    let query = "SELECT id, telegram_id, first_name, last_name, username, balance_locked, balance_available, ad_balance, created_at FROM users";
    let countQuery = "SELECT COUNT(*) as total FROM users";
    const queryParams: any[] = [];
    const countParams: any[] = [];

    if (search) {
      const searchPattern = `%${search}%`;
      const searchWhere = " WHERE username LIKE ? OR telegram_id LIKE ? OR first_name LIKE ? OR last_name LIKE ?";
      query += searchWhere;
      countQuery += searchWhere;
      queryParams.push(searchPattern, searchPattern, searchPattern, searchPattern);
      countParams.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    query += " ORDER BY id DESC LIMIT ? OFFSET ?";
    queryParams.push(limit, offset);

    const [rows]: any = await pool.query(query, queryParams);
    const [[countRow]]: any = await pool.query(countQuery, countParams);

    return NextResponse.json({
      users: rows,
      total: countRow.total,
      page,
      totalPages: Math.ceil(countRow.total / limit),
    });
  } catch (error: any) {
    console.error("Admin Users API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, balance_locked, balance_available, ad_balance } = await request.json();

    if (!id) return NextResponse.json({ error: "User ID required" }, { status: 400 });

    await pool.query(
      "UPDATE users SET balance_locked = ?, balance_available = ?, ad_balance = ? WHERE id = ?",
      [balance_locked, balance_available, ad_balance, id]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Admin Users Update Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
