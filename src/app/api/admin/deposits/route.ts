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
  const offset = (page - 1) * limit;

  try {
    let query = `
      SELECT d.*, u.first_name, u.last_name, u.username AS owner_username, u.telegram_id
      FROM deposits d
      LEFT JOIN users u ON d.user_id = u.id
    `;
    let countQuery = "SELECT COUNT(*) as total FROM deposits d";
    const queryParams: any[] = [];

    if (statusFilter !== "all") {
      if (statusFilter === "pending") {
        query += " WHERE d.status IN ('Waiting', 'pending')";
        countQuery += " WHERE d.status IN ('Waiting', 'pending')";
      } else if (statusFilter === "paid") {
        query += " WHERE d.status IN ('Paid', 'paid', 'success')";
        countQuery += " WHERE d.status IN ('Paid', 'paid', 'success')";
      } else if (statusFilter === "cancelled") {
        query += " WHERE d.status IN ('Expired', 'Cancelled', 'cancelled', 'Canceled', 'canceled', 'rejected')";
        countQuery += " WHERE d.status IN ('Expired', 'Cancelled', 'cancelled', 'Canceled', 'canceled', 'rejected')";
      }
    }

    query += " ORDER BY d.id DESC LIMIT ? OFFSET ?";
    
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
