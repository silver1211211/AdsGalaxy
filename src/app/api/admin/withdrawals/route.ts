import { NextResponse } from "next/server";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { checkAdminAuth, getAuthenticatedAdmin } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";

type ColumnRow = RowDataPacket & {
  COLUMN_NAME: string;
};

type WithdrawalRow = RowDataPacket & {
  id: number;
  user_id: number;
  amount: string | number;
  status: string | null;
  refunded: number | boolean;
  paid_out?: number | boolean;
  paid_at?: string | Date | null;
  balance_locked: string | number;
  balance_available: string | number;
};

type CountRow = RowDataPacket & {
  total: number;
};

async function getTableColumns(table: string) {
  const [rows] = await pool.query<ColumnRow[]>(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
  `, [table]);

  return new Set(rows.map((row) => row.COLUMN_NAME));
}

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

async function ensureWithdrawalActionColumns(conn: PoolConnection) {
  if (!(await columnExists(conn, "withdrawals", "refunded"))) {
    await conn.query("ALTER TABLE withdrawals ADD COLUMN refunded TINYINT(1) NOT NULL DEFAULT 0");
  }

  if (!(await columnExists(conn, "withdrawals", "reject_reason"))) {
    await conn.query("ALTER TABLE withdrawals ADD COLUMN reject_reason VARCHAR(255) NULL");
  }

  if (!(await columnExists(conn, "withdrawals", "paid_out"))) {
    await conn.query("ALTER TABLE withdrawals ADD COLUMN paid_out TINYINT(1) NOT NULL DEFAULT 0");
  }

  if (!(await columnExists(conn, "withdrawals", "paid_at"))) {
    await conn.query("ALTER TABLE withdrawals ADD COLUMN paid_at DATETIME NULL");
  }
}

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

function successResponse() {
  return NextResponse.json({ success: true });
}

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
    const [withdrawalColumns, userColumns] = await Promise.all([
      getTableColumns("withdrawals"),
      getTableColumns("users"),
    ]);
    const networkExpr = withdrawalColumns.has("network") ? "w.network" : "NULL";
    const addressExpr = withdrawalColumns.has("address") ? "w.address" : "NULL";
    const createdAtExpr = withdrawalColumns.has("created_at") ? "w.created_at" : "NULL";
    const refundedExpr = withdrawalColumns.has("refunded") ? "w.refunded" : "0";
    const rejectReasonExpr = withdrawalColumns.has("reject_reason") ? "w.reject_reason" : "NULL";
    const paidOutExpr = withdrawalColumns.has("paid_out")
      ? "w.paid_out"
      : "CASE WHEN w.status = 'success' THEN 1 ELSE 0 END";
    const paidAtExpr = withdrawalColumns.has("paid_at")
      ? "w.paid_at"
      : `CASE WHEN w.status = 'success' THEN ${createdAtExpr} ELSE NULL END`;
    const isBannedExpr = userColumns.has("status")
      ? "CASE WHEN u.status = 'banned' THEN 1 ELSE 0 END"
      : userColumns.has("is_banned")
        ? "u.is_banned"
        : "0";
    const bannedAtExpr = userColumns.has("banned_at") ? "u.banned_at" : "NULL";
    const banReasonExpr = userColumns.has("ban_reason") ? "u.ban_reason" : "NULL";
    const referralEarningsExpr = userColumns.has("total_referral_earnings") ? "u.total_referral_earnings" : "0";

    // Real platform earnings only: never manual/admin credits, deposits, or
    // current balance snapshots. Each term is one actual reward source.
    const realEarningsExpr = `(
        COALESCE((SELECT SUM(ads.publisher_reward) FROM ad_settlements ads WHERE ads.publisher_id = w.user_id), 0)
        + COALESCE((SELECT SUM(adsv.publisher_reward) FROM ad_settlements_views adsv WHERE adsv.publisher_id = w.user_id), 0)
        + COALESCE((SELECT SUM(bd.publisher_reward) FROM broadcast_deliveries bd JOIN bots b ON bd.bot_id = b.id WHERE b.user_id = w.user_id), 0)
        + COALESCE((SELECT SUM(mes.publisher_revenue) FROM miniapp_earnings_settlements mes WHERE mes.user_id = w.user_id), 0)
        + COALESCE(${referralEarningsExpr}, 0)
      )`;

    let query = `
      SELECT
        w.*,
        ${networkExpr} as network,
        ${addressExpr} as address,
        ${createdAtExpr} as created_at,
        ${refundedExpr} as refunded,
        ${rejectReasonExpr} as reject_reason,
        ${paidOutExpr} as paid_out,
        ${paidAtExpr} as paid_at,
        u.first_name,
        u.last_name,
        u.username AS owner_username,
        u.telegram_id as owner_telegram_id,
        u.balance_available,
        u.balance_locked,
        u.total_withdrawn,
        ${isBannedExpr} as is_banned,
        ${bannedAtExpr} as banned_at,
        ${banReasonExpr} as ban_reason,
        COALESCE((SELECT COUNT(*) FROM channels c WHERE c.user_id = w.user_id AND c.is_deleted = FALSE AND c.status = 'active'), 0) as channel_count,
        COALESCE((SELECT SUM(c.subscriber_count) FROM channels c WHERE c.user_id = w.user_id AND c.is_deleted = FALSE AND c.status = 'active'), 0) as total_audience,
        COALESCE((SELECT COUNT(*) FROM miniapps ma WHERE ma.user_id = w.user_id AND ma.is_deleted = FALSE), 0) as miniapp_count,
        COALESCE((SELECT SUM(mes.impressions) FROM miniapp_earnings_settlements mes WHERE mes.user_id = w.user_id), 0) as miniapp_impressions,
        COALESCE((SELECT SUM(mes.publisher_revenue) FROM miniapp_earnings_settlements mes WHERE mes.user_id = w.user_id), 0) as miniapp_earnings,
        COALESCE((SELECT SUM(w2.amount) FROM withdrawals w2 WHERE w2.user_id = w.user_id), 0) as total_withdrawal_amount,
        COALESCE((SELECT COUNT(*) FROM withdrawals w2 WHERE w2.user_id = w.user_id), 0) as withdrawal_count,
        ${realEarningsExpr} as total_earnings
      FROM withdrawals w
      LEFT JOIN users u ON w.user_id = u.id
    `;
    let countQuery = "SELECT COUNT(*) as total FROM withdrawals w LEFT JOIN users u ON w.user_id = u.id";
    const queryParams: Array<string | number> = [];

    let whereClause = " WHERE 1=1";

    if (statusFilter !== "all") {
      whereClause += " AND w.status = ?";
      queryParams.push(statusFilter);
    }

    if (search) {
      const searchTerms = [
        "w.id LIKE ?",
        "w.amount LIKE ?",
        "u.first_name LIKE ?",
        "u.last_name LIKE ?",
        "u.username LIKE ?",
        "u.telegram_id LIKE ?",
      ];

      if (withdrawalColumns.has("address")) searchTerms.push("w.address LIKE ?");
      if (withdrawalColumns.has("network")) searchTerms.push("w.network LIKE ?");

      whereClause += ` AND (${searchTerms.join(" OR ")})`;
      const searchVal = `%${search}%`;
      queryParams.push(...searchTerms.map(() => searchVal));
    }

    query += whereClause + " ORDER BY w.id DESC LIMIT ? OFFSET ?";
    countQuery += whereClause;

    const [rows] = await pool.query(query, [...queryParams, limit, offset]);
    const [countRows] = await pool.query<CountRow[]>(countQuery, queryParams);
    const countRow = countRows[0] || { total: 0 };

    return NextResponse.json({
      withdrawals: rows,
      total: countRow.total,
      page,
      totalPages: Math.ceil(countRow.total / limit),
    });
  } catch (error: unknown) {
    console.error("Admin Withdrawals API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, action, refund, reason } = await request.json();
  if (!id) return NextResponse.json({ error: "Withdrawal ID required" }, { status: 400 });

  const conn = await pool.getConnection();

  try {
    await ensureWithdrawalActionColumns(conn);
    if (action === "ban_user") {
      await ensureUserBanColumns(conn);
    }

    await conn.beginTransaction();

    const [wRows] = await conn.query<WithdrawalRow[]>(`
      SELECT w.id, w.user_id, w.amount, w.status, w.refunded, w.paid_out, u.balance_locked, u.balance_available
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
      WHERE w.id = ?
      FOR UPDATE
    `, [id]);

    if (wRows.length === 0) {
      await conn.rollback();
      return NextResponse.json({ error: "Withdrawal not found" }, { status: 404 });
    }

    const withdrawal = wRows[0];
    const amount = toNumber(withdrawal.amount);
    const currentStatus = withdrawal.status || "pending";
    const wasRefunded = Boolean(withdrawal.refunded);
    const wasPaidOut = Boolean(withdrawal.paid_out) || currentStatus === "success";

    if (action === "approve") {
      if (!wasPaidOut) {
        if (wasRefunded) {
          const available = toNumber(withdrawal.balance_available);
          if (available < amount) {
            await conn.rollback();
            return NextResponse.json({ error: "User available balance is lower than this refunded withdrawal amount" }, { status: 400 });
          }

          await conn.query("UPDATE users SET balance_available = balance_available - ?, total_withdrawn = total_withdrawn + ? WHERE id = ?", [amount, amount, withdrawal.user_id]);
        } else {
          await conn.query("UPDATE users SET balance_locked = GREATEST(balance_locked - ?, 0), total_withdrawn = total_withdrawn + ? WHERE id = ?", [amount, amount, withdrawal.user_id]);
        }
      }

      await conn.query("UPDATE withdrawals SET status = 'success', refunded = 0, paid_out = 1, paid_at = COALESCE(paid_at, NOW()) WHERE id = ?", [id]);
      await conn.commit();
      await recordAdminActionAudit({
        adminId: admin.id,
        action: "withdrawal_approve",
        entityType: "withdrawal",
        entityId: id,
        reason: reason || "approved",
        metadata: {
          admin_username: admin.username,
          withdrawal_id: Number(id),
          user_id: withdrawal.user_id,
          action: "approve",
          action_at: new Date().toISOString(),
          amount,
          previous_status: currentStatus,
          previous_refunded: wasRefunded,
          previous_paid_out: wasPaidOut,
        },
      });
      return successResponse();
    }

    if (action === "reject") {
      const shouldRefund = Boolean(refund) && currentStatus !== "success" && !wasRefunded;

      if (shouldRefund) {
        await conn.query(
          "UPDATE users SET balance_locked = GREATEST(balance_locked - ?, 0), balance_available = balance_available + ? WHERE id = ?",
          [amount, amount, withdrawal.user_id]
        );
      }

      await conn.query(
        "UPDATE withdrawals SET status = 'rejected', reject_reason = ?, refunded = ? WHERE id = ?",
        [reason || null, wasRefunded || shouldRefund ? 1 : 0, id]
      );

      await conn.commit();
      await recordAdminActionAudit({
        adminId: admin.id,
        action: "withdrawal_reject",
        entityType: "withdrawal",
        entityId: id,
        reason: reason || "rejected",
        metadata: {
          admin_username: admin.username,
          withdrawal_id: Number(id),
          user_id: withdrawal.user_id,
          action: "reject",
          action_at: new Date().toISOString(),
          amount,
          previous_status: currentStatus,
          refunded: wasRefunded || shouldRefund,
          refund_requested: Boolean(refund),
          reject_reason: reason || null,
        },
      });
      return successResponse();
    }

    if (action === "ban_user") {
      await conn.query(
        "UPDATE users SET status = 'banned', is_banned = 1, banned_at = NOW(), ban_reason = ? WHERE id = ?",
        [reason || "Withdrawal fraud review", withdrawal.user_id]
      );

      await conn.commit();
      await recordAdminActionAudit({
        adminId: admin.id,
        action: "withdrawal_ban_user",
        entityType: "withdrawal",
        entityId: id,
        reason: reason || "Withdrawal fraud review",
        metadata: {
          admin_username: admin.username,
          withdrawal_id: Number(id),
          user_id: withdrawal.user_id,
          action: "ban_user",
          action_at: new Date().toISOString(),
          amount,
          previous_status: currentStatus,
          ban_reason: reason || "Withdrawal fraud review",
        },
      });
      return successResponse();
    }

    await conn.rollback();
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: unknown) {
    await conn.rollback();
    console.error("Admin Withdrawals Update Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  } finally {
    conn.release();
  }
}
