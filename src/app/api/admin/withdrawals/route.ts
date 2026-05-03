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
      SELECT w.*, u.first_name, u.last_name, u.username AS owner_username, u.telegram_id
      FROM withdrawals w
      LEFT JOIN users u ON w.user_id = u.id
    `;
    let countQuery = "SELECT COUNT(*) as total FROM withdrawals w";
    const queryParams: any[] = [];

    if (statusFilter !== "all") {
      query += " WHERE w.status = ?";
      countQuery += " WHERE w.status = ?";
      queryParams.push(statusFilter);
    }

    query += " ORDER BY w.id DESC LIMIT ? OFFSET ?";
    
    const [rows]: any = await pool.query(query, [...queryParams, limit, offset]);
    const [[countRow]]: any = await pool.query(countQuery, queryParams);

    return NextResponse.json({
      withdrawals: rows,
      total: countRow.total,
      page,
      totalPages: Math.ceil(countRow.total / limit),
    });
  } catch (error: any) {
    console.error("Admin Withdrawals API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, action, refund, reason } = await request.json();

    if (action === "approve") {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query("UPDATE withdrawals SET status = 'success' WHERE id = ?", [id]);
        
        // Also update total_withdrawn for the user
        const [wRows]: any = await conn.query("SELECT user_id, amount FROM withdrawals WHERE id = ?", [id]);
        if (wRows.length > 0) {
           await conn.query("UPDATE users SET total_withdrawn = total_withdrawn + ? WHERE id = ?", [wRows[0].amount, wRows[0].user_id]);
        }
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
      return NextResponse.json({ success: true });
    }

    if (action === "reject") {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(
          "UPDATE withdrawals SET status = 'rejected', reject_reason = ?, refunded = ? WHERE id = ?", 
          [reason || null, refund ? 1 : 0, id]
        );

        if (refund) {
          const [wRows]: any = await conn.query("SELECT user_id, amount FROM withdrawals WHERE id = ?", [id]);
          if (wRows.length > 0) {
             await conn.query("UPDATE users SET balance_available = balance_available + ? WHERE id = ?", [wRows[0].amount, wRows[0].user_id]);
          }
        }
        
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    console.error("Admin Withdrawals Update Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
