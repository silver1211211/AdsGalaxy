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
      SELECT d.*, u.first_name, u.last_name, u.username AS owner_username, u.telegram_id as owner_telegram_id
      FROM deposits d
      LEFT JOIN users u ON d.user_id = u.id
    `;
    let countQuery = "SELECT COUNT(*) as total FROM deposits d LEFT JOIN users u ON d.user_id = u.id";
    const queryParams: any[] = [];

    let whereClause = " WHERE 1=1";

    if (statusFilter !== "all") {
      if (statusFilter === "pending") {
        whereClause += " AND d.status IN ('Waiting', 'pending')";
      } else if (statusFilter === "paid") {
        whereClause += " AND d.status IN ('Paid', 'paid', 'success')";
      } else if (statusFilter === "cancelled") {
        whereClause += " AND d.status IN ('Expired', 'Cancelled', 'cancelled', 'Canceled', 'canceled', 'rejected')";
      }
    }

    if (search) {
      whereClause += ` AND (
        d.txn_id LIKE ? OR 
        d.amount LIKE ? OR 
        d.status LIKE ? OR
        u.first_name LIKE ? OR 
        u.last_name LIKE ? OR 
        u.username LIKE ? OR 
        u.telegram_id LIKE ?
      )`;
      const searchVal = `%${search}%`;
      queryParams.push(searchVal, searchVal, searchVal, searchVal, searchVal, searchVal, searchVal);
    }

    query += whereClause + " ORDER BY d.id DESC LIMIT ? OFFSET ?";
    countQuery += whereClause;
    
    const [rows]: any = await pool.query(query, [...queryParams, limit, offset]);
    const [[countRow]]: any = await pool.query(countQuery, queryParams);

    return NextResponse.json({
      deposits: rows,
      total: countRow.total,
      page,
      totalPages: Math.ceil(countRow.total / limit),
    });
  } catch (error: any) {
    console.error("Admin Deposits API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
