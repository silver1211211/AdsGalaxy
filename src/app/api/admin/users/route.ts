import { NextResponse } from "next/server";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";

type ColumnRow = RowDataPacket & {
  COLUMN_NAME: string;
};

async function columnExists(conn: PoolConnection, table: string, column: string) {
  const [rows] = await conn.query<RowDataPacket[]>(`
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
    LIMIT 1
  `, [table, column]);

  return rows.length > 0;
}

async function ensureUserBanColumns(conn: PoolConnection) {
  if (!(await columnExists(conn, "users", "status"))) {
    await conn.query("ALTER TABLE users ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active'");
  }

  if (!(await columnExists(conn, "users", "is_banned"))) {
    await conn.query("ALTER TABLE users ADD COLUMN is_banned TINYINT(1) NOT NULL DEFAULT 0");
  }

  if (!(await columnExists(conn, "users", "banned_at"))) {
    await conn.query("ALTER TABLE users ADD COLUMN banned_at DATETIME NULL");
  }

  if (!(await columnExists(conn, "users", "ban_reason"))) {
    await conn.query("ALTER TABLE users ADD COLUMN ban_reason VARCHAR(255) NULL");
  }
}

async function getUserColumns() {
  const [rows] = await pool.query<ColumnRow[]>(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
  `);

  return new Set(rows.map((row) => row.COLUMN_NAME));
}

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
    const columns = await getUserColumns();
    const statusExpr = columns.has("status")
      ? "status"
      : columns.has("is_banned")
        ? "IF(COALESCE(is_banned, 0) = 1, 'banned', 'active')"
        : "'active'";
    const bannedAtExpr = columns.has("banned_at") ? "banned_at" : "NULL";
    const banReasonExpr = columns.has("ban_reason") ? "ban_reason" : "NULL";

    let query = `
      SELECT id, telegram_id, first_name, last_name, username, balance_locked, balance_available,
        ad_balance, created_at, ${statusExpr} as status,
        CASE WHEN ${statusExpr} = 'banned' THEN 1 ELSE 0 END as is_banned,
        ${bannedAtExpr} as banned_at,
        ${banReasonExpr} as ban_reason
      FROM users
    `;
    let countQuery = "SELECT COUNT(*) as total FROM users";
    const queryParams: Array<string | number> = [];
    const countParams: string[] = [];

    if (search) {
      const searchPattern = `%${search}%`;
      const searchWhere = " WHERE username LIKE ? OR telegram_id LIKE ? OR first_name LIKE ? OR last_name LIKE ?";
      query += searchWhere;
      countQuery += searchWhere;
      queryParams.push(searchPattern, searchPattern, searchPattern, searchPattern);
      countParams.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    query += " ORDER BY id DESC LIMIT ? OFFSET ?";

    const [rows] = await pool.query(query, [...queryParams, limit, offset]);
    const [[countRow]]: any = await pool.query(countQuery, countParams);

    return NextResponse.json({
      users: rows,
      total: countRow.total,
      page,
      totalPages: Math.ceil(countRow.total / limit),
    });
  } catch (error: unknown) {
    console.error("Admin Users API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conn = await pool.getConnection();

  try {
    const { id, balance_locked, balance_available, ad_balance, action, reason } = await request.json();

    if (!id) return NextResponse.json({ error: "User ID required" }, { status: 400 });

    await ensureUserBanColumns(conn);

    if (action === "ban") {
      await conn.query(
        "UPDATE users SET status = 'banned', is_banned = 1, banned_at = NOW(), ban_reason = ? WHERE id = ?",
        [reason || "Admin ban", id]
      );
      return NextResponse.json({ success: true });
    }

    if (action === "unban") {
      await conn.query(
        "UPDATE users SET status = 'active', is_banned = 0, banned_at = NULL, ban_reason = NULL WHERE id = ?",
        [id]
      );
      return NextResponse.json({ success: true });
    }

    await conn.query(
      "UPDATE users SET balance_locked = ?, balance_available = ?, ad_balance = ? WHERE id = ?",
      [balance_locked, balance_available, ad_balance, id]
    );

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Admin Users Update Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  } finally {
    conn.release();
  }
}
