import { NextResponse } from "next/server";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { checkAdminAuth, requireAdminPermission } from "@/lib/adminAuth";
import { ADVERTISER_TRUST_LEVELS, normalizeAdvertiserTrustLevel } from "@/lib/advertiserTrust";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";

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
  const trustFilter = normalizeAdvertiserTrustLevel(searchParams.get("trust") || "all");
  const rawTrustFilter = searchParams.get("trust") || "all";
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
    const trustExpr = columns.has("advertiser_trust_level") ? "advertiser_trust_level" : "'new'";
    const publisherTrustExpr = columns.has("publisher_trust_score") ? "publisher_trust_score" : "60";
    const publisherRiskExpr = columns.has("publisher_risk_score") ? "publisher_risk_score" : "0";
    const trustUpdatedExpr = columns.has("advertiser_trust_updated_at") ? "advertiser_trust_updated_at" : "NULL";
    const trustNoteExpr = columns.has("advertiser_trust_note") ? "advertiser_trust_note" : "NULL";

    let query = `
      SELECT id, telegram_id, first_name, last_name, username, balance_locked, balance_available,
        ad_balance, created_at, ${statusExpr} as status,
        CASE WHEN ${statusExpr} = 'banned' THEN 1 ELSE 0 END as is_banned,
        ${bannedAtExpr} as banned_at,
        ${banReasonExpr} as ban_reason,
        ${trustExpr} as advertiser_trust_level,
        ${publisherTrustExpr} as publisher_trust_score,
        ${publisherRiskExpr} as publisher_risk_score,
        ${trustUpdatedExpr} as advertiser_trust_updated_at,
        ${trustNoteExpr} as advertiser_trust_note,
        (
          SELECT COUNT(*) FROM campaigns c WHERE c.user_id = users.id
        ) + (
          SELECT COUNT(*) FROM miniapp_rewarded_campaigns mrc WHERE mrc.advertiser_id = users.id
        ) as advertiser_total_campaigns,
        (
          SELECT COUNT(*) FROM campaigns c WHERE c.user_id = users.id AND c.status IN ('active', 'completed', 'budget_exhausted')
        ) + (
          SELECT COUNT(*) FROM miniapp_rewarded_campaigns mrc WHERE mrc.advertiser_id = users.id AND mrc.status IN ('approved', 'completed')
        ) as advertiser_approved_campaigns,
        (
          SELECT COUNT(*) FROM campaigns c WHERE c.user_id = users.id AND c.status = 'rejected'
        ) + (
          SELECT COUNT(*) FROM miniapp_rewarded_campaigns mrc WHERE mrc.advertiser_id = users.id AND mrc.status = 'rejected'
        ) as advertiser_rejected_campaigns,
        (
          SELECT COALESCE(SUM(amount), 0) FROM advertiser_transactions atx WHERE atx.user_id = users.id AND atx.type = 'debit'
        ) as advertiser_total_spend
      FROM users
    `;
    let countQuery = "SELECT COUNT(*) as total FROM users";
    const queryParams: Array<string | number> = [];
    const countParams: string[] = [];

    const whereParts: string[] = [];
    if (rawTrustFilter !== "all") {
      whereParts.push(`${trustExpr} = ?`);
      queryParams.push(trustFilter);
      countParams.push(trustFilter);
    }

    if (search) {
      const searchPattern = `%${search}%`;
      whereParts.push("(username LIKE ? OR telegram_id LIKE ? OR first_name LIKE ? OR last_name LIKE ?)");
      queryParams.push(searchPattern, searchPattern, searchPattern, searchPattern);
      countParams.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }

    if (whereParts.length > 0) {
      const where = ` WHERE ${whereParts.join(" AND ")}`;
      query += where;
      countQuery += where;
    }

    query += " ORDER BY id DESC LIMIT ? OFFSET ?";

    const [rows] = await pool.query(query, [...queryParams, limit, offset]);
    const [[countRow]] = await pool.query<Array<RowDataPacket & { total: number }>>(countQuery, countParams);
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
  const { admin, response } = await requireAdminPermission("dangerous");
  if (response) return response;

  const conn = await pool.getConnection();

  try {
    const { id, balance_locked, balance_available, ad_balance, action, reason, trust_level } = await request.json();

    if (!id) return NextResponse.json({ error: "User ID required" }, { status: 400 });

    const [beforeRows] = await conn.query<RowDataPacket[]>(
      "SELECT balance_locked, balance_available, ad_balance, status, advertiser_trust_level FROM users WHERE id = ? LIMIT 1",
      [id]
    );
    const before = beforeRows[0];
    if (!before) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const audit = (auditAction: string, metadata: Record<string, unknown>) => recordAdminActionAudit({
      adminId: admin?.id,
      action: auditAction,
      entityType: "user",
      entityId: id,
      reason: reason || auditAction,
      metadata,
    });

    await ensureUserBanColumns(conn);

    if (!(await columnExists(conn, "users", "advertiser_trust_level"))) {
      await conn.query("ALTER TABLE users ADD COLUMN advertiser_trust_level VARCHAR(20) NOT NULL DEFAULT 'new'");
    }

    if (!(await columnExists(conn, "users", "advertiser_trust_updated_at"))) {
      await conn.query("ALTER TABLE users ADD COLUMN advertiser_trust_updated_at DATETIME NULL");
    }

    if (!(await columnExists(conn, "users", "advertiser_trust_note"))) {
      await conn.query("ALTER TABLE users ADD COLUMN advertiser_trust_note VARCHAR(255) NULL");
    }

    if (action === "ban") {
      await conn.query(
        "UPDATE users SET status = 'banned', is_banned = 1, banned_at = NOW(), ban_reason = ? WHERE id = ?",
        [reason || "Admin ban", id]
      );
      await audit("publisher_ban", { previous_status: before.status, new_status: "banned" });
      return NextResponse.json({ success: true });
    }

    if (action === "unban") {
      await conn.query(
        "UPDATE users SET status = 'active', is_banned = 0, banned_at = NULL, ban_reason = NULL WHERE id = ?",
        [id]
      );
      await conn.query(
        `UPDATE channels SET status='active',paused_reason=NULL,auto_paused_at=NULL
         WHERE user_id=? AND is_deleted=FALSE AND status='paused' AND paused_reason='fraudulent_or_low_quality_traffic'`,
        [id]
      );
      await audit("publisher_unban", { previous_status: before.status, new_status: "active" });
      return NextResponse.json({ success: true });
    }

    if (action === "set_advertiser_trust") {
      const level = normalizeAdvertiserTrustLevel(trust_level);
      if (!ADVERTISER_TRUST_LEVELS.includes(level)) {
        return NextResponse.json({ error: "Invalid advertiser trust level" }, { status: 400 });
      }
      await conn.query(
        "UPDATE users SET advertiser_trust_level = ?, advertiser_trust_updated_at = NOW(), advertiser_trust_note = ? WHERE id = ?",
        [level, reason || null, id]
      );
      if (level === "restricted") {
        await conn.query("UPDATE campaigns SET status = 'paused' WHERE user_id = ? AND status = 'active'", [id]);
        await conn.query("UPDATE miniapp_rewarded_campaigns SET status = 'paused' WHERE advertiser_id = ? AND status = 'approved'", [id]);
      }
      await audit("advertiser_trust_change", { previous_level: before.advertiser_trust_level, new_level: level });
      return NextResponse.json({ success: true });
    }

    const nextBalances = [balance_locked, balance_available, ad_balance].map(Number);
    if (nextBalances.some((value) => !Number.isFinite(value) || value < 0)) {
      return NextResponse.json({ error: "Balances must be finite, non-negative numbers" }, { status: 400 });
    }

    await conn.query(
      "UPDATE users SET balance_locked = ?, balance_available = ?, ad_balance = ? WHERE id = ?",
      [...nextBalances, id]
    );

    await audit("user_balance_adjustment", {
      previous: { balance_locked: before.balance_locked, balance_available: before.balance_available, ad_balance: before.ad_balance },
      next: { balance_locked: nextBalances[0], balance_available: nextBalances[1], ad_balance: nextBalances[2] },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Admin Users Update Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  } finally {
    conn.release();
  }
}
