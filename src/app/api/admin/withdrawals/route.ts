import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { addReferralDecimals, normalizeReferralDecimal } from "@/lib/paidReferralEarnings";
import { checkAdminAuth, requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { notifyWithdrawalPaid, notifyWithdrawalRejected } from "@/lib/publisherNotifications";
import { assessWithdrawalPreclearance } from "@/lib/channelSafety";
import { parseAdminPagination } from "@/lib/adminPagination";

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
  network?: string | null;
  telegram_id?: string | number | null;
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
  const preclearanceId = Number.parseInt(searchParams.get("preclearance_id") || "", 10);
  if (Number.isSafeInteger(preclearanceId) && preclearanceId > 0) {
    try {
      return NextResponse.json({ preclearance: await assessWithdrawalPreclearance(preclearanceId) });
    } catch (error) {
      console.error("Withdrawal pre-clearance unavailable", {
        withdrawal_id: preclearanceId,
        error: error instanceof Error ? error.message : "unknown_error",
      });
      return NextResponse.json({ error: "Safety assessment is temporarily unavailable" }, { status: 503 });
    }
  }

  const { page, limit, offset } = parseAdminPagination(searchParams, { defaultLimit: 10 });
  const statusFilter = searchParams.get("status") || "all";
  const search = searchParams.get("search") || "";

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
    const referralCacheExpr = userColumns.has("total_referral_earnings") ? "u.total_referral_earnings" : "NULL";

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
        ${referralCacheExpr} as referral_earnings_cache
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

    const [[rows], [countRows]] = await Promise.all([
      pool.query<Array<RowDataPacket & Record<string, unknown>>>(query, [...queryParams, limit, offset]),
      pool.query<CountRow[]>(countQuery, queryParams),
    ]);
    const userIds = [...new Set(rows.map((row) => Number(row.user_id)).filter(Number.isSafeInteger))];
    const immutableByUser = new Map<number, string>();
    const channelByUser = new Map<number, RowDataPacket>();
    const miniAppByUser = new Map<number, RowDataPacket>();
    const miniAppEarningsByUser = new Map<number, RowDataPacket>();
    const withdrawalByUser = new Map<number, RowDataPacket>();
    const earningsByUser = new Map<number, RowDataPacket>();
    if (userIds.length > 0) {
      const [[referralRows], [channelRows], [miniAppRows], [miniAppEarningsRows], [withdrawalRows], [earningsRows]] = await Promise.all([
        pool.query<Array<RowDataPacket & { user_id: number; paid_referral_earnings: string }>>(
          `SELECT user_id, CAST(COALESCE(SUM(amount),0) AS DECIMAL(24,8)) paid_referral_earnings
           FROM referral_reward_ledger WHERE status='paid' AND user_id IN (?) GROUP BY user_id`, [userIds]),
        pool.query<RowDataPacket[]>(
          `SELECT user_id,COUNT(*) channel_count,COALESCE(SUM(subscriber_count),0) total_audience
           FROM channels WHERE is_deleted=FALSE AND status='active' AND user_id IN (?) GROUP BY user_id`, [userIds]),
        pool.query<RowDataPacket[]>(
          `SELECT user_id,COUNT(*) miniapp_count FROM miniapps
           WHERE is_deleted=FALSE AND user_id IN (?) GROUP BY user_id`, [userIds]),
        pool.query<RowDataPacket[]>(
          `SELECT user_id,COALESCE(SUM(impressions),0) miniapp_impressions,COALESCE(SUM(publisher_revenue),0) miniapp_earnings
           FROM miniapp_earnings_settlements WHERE user_id IN (?) GROUP BY user_id`, [userIds]),
        pool.query<RowDataPacket[]>(
          `SELECT user_id,COALESCE(SUM(amount),0) total_withdrawal_amount,COUNT(*) withdrawal_count
           FROM withdrawals WHERE user_id IN (?) GROUP BY user_id`, [userIds]),
        pool.query<RowDataPacket[]>(
          `SELECT user_id,COALESCE(SUM(amount),0) non_referral_earnings FROM (
             SELECT publisher_id user_id,publisher_reward amount FROM ad_settlements WHERE publisher_id IN (?)
             UNION ALL SELECT publisher_id,publisher_reward FROM ad_settlements_views WHERE publisher_id IN (?)
             UNION ALL SELECT b.user_id,bd.publisher_reward FROM broadcast_deliveries bd JOIN bots b ON b.id=bd.bot_id WHERE b.user_id IN (?)
             UNION ALL SELECT user_id,publisher_revenue FROM miniapp_earnings_settlements WHERE user_id IN (?)
           ) earned GROUP BY user_id`, [userIds, userIds, userIds, userIds]),
      ]);
      for (const referralRow of referralRows) {
        immutableByUser.set(Number(referralRow.user_id), normalizeReferralDecimal(referralRow.paid_referral_earnings));
      }
      const loadMap = (target: Map<number, RowDataPacket>, source: RowDataPacket[]) => {
        for (const row of source) target.set(Number(row.user_id), row);
      };
      loadMap(channelByUser, channelRows);
      loadMap(miniAppByUser, miniAppRows);
      loadMap(miniAppEarningsByUser, miniAppEarningsRows);
      loadMap(withdrawalByUser, withdrawalRows);
      loadMap(earningsByUser, earningsRows);
    }
    const reviewRows = rows.map((row) => {
      const userId = Number(row.user_id);
      const referralEarnings = immutableByUser.get(userId) || "0.00000000";
      const channel = channelByUser.get(userId);
      const miniApp = miniAppByUser.get(userId);
      const miniAppEarnings = miniAppEarningsByUser.get(userId);
      const withdrawal = withdrawalByUser.get(userId);
      const nonReferralEarnings = earningsByUser.get(userId)?.non_referral_earnings || 0;
      return {
        ...row,
        channel_count: channel?.channel_count || 0,
        total_audience: channel?.total_audience || 0,
        miniapp_count: miniApp?.miniapp_count || 0,
        miniapp_impressions: miniAppEarnings?.miniapp_impressions || 0,
        miniapp_earnings: miniAppEarnings?.miniapp_earnings || 0,
        total_withdrawal_amount: withdrawal?.total_withdrawal_amount || 0,
        withdrawal_count: withdrawal?.withdrawal_count || 0,
        non_referral_earnings: nonReferralEarnings,
        referral_earnings: referralEarnings,
        total_earnings: addReferralDecimals(nonReferralEarnings, referralEarnings),
        earnings_review_complete: true,
        preclearance: null,
      };
    });
    const countRow = countRows[0] || { total: 0 };

    return NextResponse.json({
      withdrawals: reviewRows,
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
  const { admin, response } = await requireAdminPermission("dangerous");
  if (response) return response;

  const { id, action, refund, reason } = await request.json();
  if (!id) return NextResponse.json({ error: "Withdrawal ID required" }, { status: 400 });

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [wRows] = await conn.query<WithdrawalRow[]>(`
      SELECT w.id, w.user_id, w.amount, w.status, w.refunded, w.paid_out, w.network, u.balance_locked, u.balance_available, u.telegram_id
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
      let preclearanceOverride: Awaited<ReturnType<typeof assessWithdrawalPreclearance>> | null = null;
      if (!wasPaidOut) {
        const preclearance = await assessWithdrawalPreclearance(Number(id), conn);
        if (preclearance.state !== "cleared") {
          if (String(reason || "").trim().length < 8) {
            await conn.rollback();
            return NextResponse.json({ error: "Enter an admin review note of at least 8 characters to override the safety hold", preclearance }, { status: 409 });
          }
          preclearanceOverride = preclearance;
        }
        if (wasRefunded) {
          const available = toNumber(withdrawal.balance_available);
          if (available < amount) {
            await conn.rollback();
            return NextResponse.json({ error: "User available balance is lower than this refunded withdrawal amount" }, { status: 400 });
          }

          const [availableDebitResult] = await conn.query<ResultSetHeader>(
            "UPDATE users SET balance_available = balance_available - ?, total_withdrawn = total_withdrawn + ? WHERE id = ? AND balance_available >= ?",
            [amount, amount, withdrawal.user_id, amount]
          );
          if (availableDebitResult.affectedRows !== 1) {
            await conn.rollback();
            return NextResponse.json({ error: "User available balance changed before approval; retry after refresh" }, { status: 409 });
          }
        } else {
          const [lockedDebitResult] = await conn.query<ResultSetHeader>(
            "UPDATE users SET balance_locked = balance_locked - ?, total_withdrawn = total_withdrawn + ? WHERE id = ? AND balance_locked >= ?",
            [amount, amount, withdrawal.user_id, amount]
          );
          if (lockedDebitResult.affectedRows !== 1) {
            await conn.rollback();
            return NextResponse.json({ error: "User locked balance is lower than this withdrawal amount" }, { status: 409 });
          }
        }
      }

      await conn.query("UPDATE withdrawals SET status = 'success', refunded = 0, paid_out = 1, paid_at = COALESCE(paid_at, NOW()) WHERE id = ?", [id]);
      await conn.commit();
      // wasPaidOut was read under FOR UPDATE, so a retried/duplicate approve
      // call always observes the already-paid row and skips renotifying.
      if (!wasPaidOut) {
        await notifyWithdrawalPaid(withdrawal.telegram_id, { withdrawalId: id, amount, network: withdrawal.network });
      }
      await recordAdminActionAudit({
        adminId: admin?.id,
        action: "withdrawal_approve",
        entityType: "withdrawal",
        entityId: id,
        reason: reason || "approved",
        metadata: {
          admin_username: admin?.username,
          withdrawal_id: Number(id),
          user_id: withdrawal.user_id,
          action: "approve",
          action_at: new Date().toISOString(),
          amount,
          previous_status: currentStatus,
          previous_refunded: wasRefunded,
          previous_paid_out: wasPaidOut,
          preclearance_override: preclearanceOverride ? {
            state: preclearanceOverride.state,
            reasons: preclearanceOverride.reasons,
            risk_score: preclearanceOverride.risk.score,
            risk_state: preclearanceOverride.risk.state,
          } : null,
        },
      });
      return successResponse();
    }

    if (action === "reject") {
      const shouldRefund = Boolean(refund) && currentStatus !== "success" && !wasRefunded;

      if (shouldRefund) {
        const [refundResult] = await conn.query<ResultSetHeader>(
          "UPDATE users SET balance_locked = balance_locked - ?, balance_available = balance_available + ? WHERE id = ? AND balance_locked >= ?",
          [amount, amount, withdrawal.user_id, amount]
        );
        if (refundResult.affectedRows !== 1) {
          await conn.rollback();
          return NextResponse.json({ error: "User locked balance is lower than this withdrawal amount" }, { status: 409 });
        }
      }

      await conn.query(
        "UPDATE withdrawals SET status = 'rejected', reject_reason = ?, refunded = ?, updated_at = NOW() WHERE id = ?",
        [reason || null, wasRefunded || shouldRefund ? 1 : 0, id]
      );

      await conn.commit();
      if (currentStatus !== "rejected") {
        await notifyWithdrawalRejected(withdrawal.telegram_id, {
          withdrawalId: id,
          amount,
          reason: reason || null,
          refunded: wasRefunded || shouldRefund,
        });
      }
      await recordAdminActionAudit({
        adminId: admin?.id,
        action: "withdrawal_reject",
        entityType: "withdrawal",
        entityId: id,
        reason: reason || "rejected",
        metadata: {
          admin_username: admin?.username,
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
        adminId: admin?.id,
        action: "withdrawal_ban_user",
        entityType: "withdrawal",
        entityId: id,
        reason: reason || "Withdrawal fraud review",
        metadata: {
          admin_username: admin?.username,
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
