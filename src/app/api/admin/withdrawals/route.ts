import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { addReferralDecimals } from "@/lib/paidReferralEarnings";
import { checkAdminAuth, requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { notifyWithdrawalPaid, notifyWithdrawalRejected } from "@/lib/publisherNotifications";
import { assessWithdrawalPreclearance } from "@/lib/channelSafety";
import { parseAdminPagination } from "@/lib/adminPagination";
import {
  enqueueWithdrawalVerification,
  getLatestVerificationForWithdrawal,
  getBatchVerificationForWithdrawals,
  processNextVerificationTask,
} from "@/lib/withdrawalVerification";

import { withFinancialPostingContext } from "@/lib/financialPostingContext";
import { MIN_WITHDRAWAL_UNITS, parseWithdrawalUnits } from "@/lib/withdrawalAmount";
import { validateWithdrawalDestination } from "@/lib/withdrawalNetworks";
import { dryRunWithdrawalRefund } from "@/lib/withdrawalRefundRecovery";
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
  idempotency_key?: string | null;
  balance_locked: string | number;
  balance_available: string | number;
  network?: string | null;
  address?: string | null;
  created_at?: string | Date | null;
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
  const refundDryRunId = Number.parseInt(searchParams.get("refund_dry_run_id") || "", 10);
  if (Number.isSafeInteger(refundDryRunId) && refundDryRunId > 0) {
    try {
      return NextResponse.json({ refund_dry_run: await dryRunWithdrawalRefund(refundDryRunId) });
    } catch (error) {
      console.error("Withdrawal refund dry run unavailable", error);
      return NextResponse.json({ error: "Refund evidence temporarily unavailable" }, { status: 503 });
    }
  }
  const detailUserId = Number.parseInt(searchParams.get("earnings_detail_user_id") || "", 10);
  if (Number.isSafeInteger(detailUserId) && detailUserId > 0) {
    try {
      const [[channels], [bots], [miniapps], [referrals]] = await Promise.all([
        pool.query<RowDataPacket[]>(
          `SELECT c.id,c.title,CAST(COALESCE(SUM(s.publisher_reward),0) AS DECIMAL(24,8)) earnings
           FROM channels c JOIN (
             SELECT channel_id,publisher_reward FROM ad_settlements
             WHERE publisher_id=? AND status='unlocked' AND fraud_adjusted_at IS NULL
             UNION ALL SELECT channel_id,publisher_reward FROM ad_settlements_views
             WHERE publisher_id=? AND status='unlocked' AND fraud_adjusted_at IS NULL
           ) s ON s.channel_id=c.id WHERE c.user_id=?
           GROUP BY c.id,c.title ORDER BY earnings DESC,c.id LIMIT 100`,
          [detailUserId,detailUserId,detailUserId]
        ),
        pool.query<RowDataPacket[]>(
          `SELECT b.id,b.bot_name name,COUNT(bd.id) impressions,
                  CAST(COALESCE(SUM(bd.publisher_reward),0) AS DECIMAL(24,8)) earnings
           FROM bots b JOIN broadcast_deliveries bd ON bd.bot_id=b.id
           WHERE b.user_id=? AND bd.status='sent' AND bd.publisher_settled_at IS NOT NULL
           GROUP BY b.id,b.bot_name ORDER BY earnings DESC,b.id LIMIT 100`, [detailUserId]
        ),
        pool.query<RowDataPacket[]>(
          `SELECT m.id,m.miniapp_name name,COALESCE(SUM(s.impressions),0) impressions,
                  CAST(COALESCE(SUM(s.publisher_revenue),0) AS DECIMAL(24,8)) earnings
           FROM miniapps m JOIN miniapp_earnings_settlements s ON s.miniapp_id=m.id
           WHERE m.user_id=? AND s.status='unlocked'
           GROUP BY m.id,m.miniapp_name ORDER BY earnings DESC,m.id LIMIT 100`, [detailUserId]
        ),
        pool.query<RowDataPacket[]>(
          `SELECT source,CAST(SUM(amount) AS DECIMAL(24,8)) earnings FROM (
             SELECT reward_type source,amount FROM referral_reward_ledger
             WHERE user_id=? AND status='paid'
               AND reward_type NOT IN ('publisher_join_channel','publisher_commission','referral_commission','daily_referral_commission')
             UNION ALL SELECT 'publisher_commission',amount FROM referral_commission_ledger
             WHERE referrer_user_id=? AND status IN ('settled','paid')
             UNION ALL SELECT 'advertiser_deposit_commission',commission_amount FROM referral_revenue_commissions
             WHERE referrer_user_id=? AND status IN ('settled','paid')
           ) settled_referrals GROUP BY source ORDER BY source LIMIT 100`,
          [detailUserId,detailUserId,detailUserId]
        ),
      ]);
      return NextResponse.json({ channels,bots,miniapps,referrals,limit_per_source:100 });
    } catch (error) {
      console.error("Withdrawal earnings detail unavailable", error);
      return NextResponse.json({ error: "Earnings details temporarily unavailable" }, { status: 503 });
    }
  }
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

    if (search.trim()) {
      const term = `%${search.trim()}%`;
      const searchNum = Number.parseInt(search.trim(), 10);
      const isSearchNum = Number.isSafeInteger(searchNum);

      whereClause += ` AND (
        u.username LIKE ? OR
        u.first_name LIKE ? OR
        u.last_name LIKE ? OR
        u.telegram_id LIKE ? OR
        w.address LIKE ?
        ${isSearchNum ? "OR w.id = ? OR w.user_id = ?" : ""}
      )`;
      queryParams.push(term, term, term, term, term);
      if (isSearchNum) {
        queryParams.push(searchNum, searchNum);
      }
    }

    query += whereClause + " ORDER BY w.id DESC LIMIT ? OFFSET ?";
    countQuery += whereClause;

    const [[rows], [countRows]] = await Promise.all([
      pool.query<Array<RowDataPacket & Record<string, unknown>>>(query, [...queryParams, limit, offset]),
      pool.query<CountRow[]>(countQuery, queryParams),
    ]);
    const userIds = [...new Set(rows.map((row) => Number(row.user_id)).filter(Number.isSafeInteger))];
    const withdrawalIds = rows.map((row) => Number(row.id)).filter(Number.isSafeInteger);

    const channelByUser = new Map<number, RowDataPacket>();
    const miniAppByUser = new Map<number, RowDataPacket>();
    const miniAppEarningsByUser = new Map<number, RowDataPacket>();
    const verifiedChannelByUser = new Map<number, RowDataPacket>();
    const verifiedBotByUser = new Map<number, RowDataPacket>();
    const referralCountByUser = new Map<number, RowDataPacket>();
    const verifiedReferralByUser = new Map<number, RowDataPacket>();
    const withdrawalByUser = new Map<number, RowDataPacket>();

    // Parallel fetch: user metrics and batch withdrawal verifications
    const [userMetricsResults, verificationMap, refundEvidenceRows] = await Promise.all([
      userIds.length > 0
        ? Promise.all([
            pool.query<RowDataPacket[]>(
              `SELECT user_id,COUNT(*) channel_count,COALESCE(SUM(subscriber_count),0) total_audience
               FROM channels WHERE is_deleted=FALSE AND status='active' AND user_id IN (?) GROUP BY user_id`,
              [userIds]
            ),
            pool.query<RowDataPacket[]>(
              `SELECT user_id,COUNT(*) miniapp_count FROM miniapps
               WHERE is_deleted=FALSE AND status='approved' AND user_id IN (?) GROUP BY user_id`,
              [userIds]
            ),
            pool.query<RowDataPacket[]>(
              `SELECT user_id,COALESCE(SUM(impressions),0) miniapp_impressions,COALESCE(SUM(publisher_revenue),0) miniapp_earnings
               FROM miniapp_earnings_settlements WHERE status='unlocked' AND user_id IN (?) GROUP BY user_id`,
              [userIds]
            ),
            pool.query<RowDataPacket[]>(
              `SELECT user_id,COALESCE(SUM(amount),0) total_withdrawal_amount,COUNT(*) withdrawal_count
               FROM withdrawals WHERE user_id IN (?) GROUP BY user_id`,
              [userIds]
            ),
            pool.query<RowDataPacket[]>(
              `SELECT publisher_id user_id,CAST(SUM(publisher_reward) AS DECIMAL(24,8)) channel_earnings
               FROM (
                 SELECT publisher_id,publisher_reward FROM ad_settlements
                 WHERE publisher_id IN (?) AND status='unlocked' AND fraud_adjusted_at IS NULL
                 UNION ALL
                 SELECT publisher_id,publisher_reward FROM ad_settlements_views
                 WHERE publisher_id IN (?) AND status='unlocked' AND fraud_adjusted_at IS NULL
               ) verified_channel GROUP BY publisher_id`,
              [userIds, userIds]
            ),
            pool.query<RowDataPacket[]>(
              `SELECT b.user_id,COUNT(*) bot_impressions,CAST(COALESCE(SUM(bd.publisher_reward),0) AS DECIMAL(24,8)) bot_earnings
               FROM broadcast_deliveries bd JOIN bots b ON b.id=bd.bot_id
               WHERE b.user_id IN (?) AND bd.status='sent' AND bd.publisher_settled_at IS NOT NULL
               GROUP BY b.user_id`,
              [userIds]
            ),
            pool.query<RowDataPacket[]>(
              `SELECT user_id,COUNT(*) bot_count FROM bots
               WHERE user_id IN (?) AND is_deleted=FALSE AND status='active' GROUP BY user_id`,
              [userIds]
            ),
            pool.query<RowDataPacket[]>(
              `SELECT invited_by user_id,COUNT(DISTINCT user_id) referral_count
               FROM referrals WHERE invited_by IN (?) GROUP BY invited_by`,
              [userIds]
            ),
            pool.query<RowDataPacket[]>(
              `SELECT user_id,CAST(SUM(amount) AS DECIMAL(24,8)) verified_referral_earnings FROM (
                 SELECT user_id,amount FROM referral_reward_ledger
                 WHERE user_id IN (?) AND status='paid'
                   AND reward_type NOT IN ('publisher_join_channel','publisher_commission','referral_commission','daily_referral_commission')
                 UNION ALL SELECT referrer_user_id,amount FROM referral_commission_ledger
                 WHERE referrer_user_id IN (?) AND status IN ('settled','paid')
                 UNION ALL SELECT referrer_user_id,commission_amount FROM referral_revenue_commissions
                 WHERE referrer_user_id IN (?) AND status IN ('settled','paid')
               ) paid_referral GROUP BY user_id`,
              [userIds, userIds, userIds]
            ),
          ])
        : Promise.resolve([[], [], [], [], [], [], [], [], []]),
      getBatchVerificationForWithdrawals(withdrawalIds),
      withdrawalIds.length > 0
        ? pool.query<Array<RowDataPacket & { id: number; refund_available: string; refund_locked: string; event_count: number; malformed_events: number }>>(
            `SELECT CAST(source_record_id AS UNSIGNED) id,
                    CAST(SUM(delta_available) AS DECIMAL(24,8)) refund_available,
                    CAST(SUM(delta_locked) AS DECIMAL(24,8)) refund_locked,
                    COUNT(*) event_count,
                    SUM(CASE WHEN delta_available>0 AND delta_locked=-delta_available THEN 0 ELSE 1 END) malformed_events
             FROM publisher_balance_events
             WHERE source_system IN ('withdrawal_refund','withdrawal_refund_recovery') AND source_record_id IN (?)
             GROUP BY source_record_id`, [withdrawalIds]
          ).then(([eventRows]) => eventRows)
        : Promise.resolve([]),
    ]);
    const refundEvidence = new Map(refundEvidenceRows.map((event) => [Number(event.id), event]));

    if (userIds.length > 0 && Array.isArray(userMetricsResults[0])) {
      const [
        [channelRows],
        [miniAppRows],
        [miniAppEarningsRows],
        [withdrawalRows],
        [verifiedChannelRows],
        [verifiedBotRows],
        [botCountRows],
        [referralCountRows],
        [verifiedReferralRows],
      ] = userMetricsResults as any;

      const loadMap = (target: Map<number, RowDataPacket>, source: RowDataPacket[]) => {
        for (const row of source || []) target.set(Number(row.user_id), row);
      };
      loadMap(channelByUser, channelRows);
      loadMap(miniAppByUser, miniAppRows);
      loadMap(miniAppEarningsByUser, miniAppEarningsRows);
      loadMap(withdrawalByUser, withdrawalRows);
      loadMap(verifiedChannelByUser, verifiedChannelRows);
      loadMap(verifiedBotByUser, verifiedBotRows);
      for (const row of botCountRows || []) {
        const userId = Number(row.user_id);
        verifiedBotByUser.set(userId, { ...(verifiedBotByUser.get(userId) || {}), ...row });
      }
      loadMap(referralCountByUser, referralCountRows);
      loadMap(verifiedReferralByUser, verifiedReferralRows);
    }

    const reviewRows = rows.map((row) => {
      const userId = Number(row.user_id);
      const withdrawalId = Number(row.id);
      const referralEarnings = verifiedReferralByUser.get(userId)?.verified_referral_earnings || "0.00000000";
      const channel = channelByUser.get(userId);
      const miniApp = miniAppByUser.get(userId);
      const miniAppEarnings = miniAppEarningsByUser.get(userId);
      const withdrawal = withdrawalByUser.get(userId);
      const verifiedChannel = verifiedChannelByUser.get(userId);
      const verifiedBot = verifiedBotByUser.get(userId);
      const referralCount = referralCountByUser.get(userId);
      const verifiedReferral = verifiedReferralByUser.get(userId);
      const nonReferralEarnings = addReferralDecimals(
        addReferralDecimals(verifiedChannel?.channel_earnings || "0.00000000", verifiedBot?.bot_earnings || "0.00000000"),
        miniAppEarnings?.miniapp_earnings || "0.00000000"
      );
      const ver = verificationMap.get(withdrawalId);
      const refundEvent = refundEvidence.get(withdrawalId);
      const refundAmount = parseWithdrawalUnits(String(row.amount));
      const verifiedRefund = refundEvent && refundAmount !== null
        && parseWithdrawalUnits(String(refundEvent.refund_available)) === refundAmount
        && parseWithdrawalUnits(String(refundEvent.refund_locked).replace(/^-/u, "")) === refundAmount
        && String(refundEvent.refund_locked).startsWith("-")
        && Number(refundEvent.event_count) >= 1
        && Number(refundEvent.malformed_events) === 0;

      return {
        ...row,
        refund_evidence_status: verifiedRefund ? "verified" : refundEvent ? "conflicting" : row.refunded ? "historical_unverified" : "no_ledger_event",
        channel_count: channel?.channel_count || 0,
        total_audience: channel?.total_audience || 0,
        miniapp_count: miniApp?.miniapp_count || 0,
        miniapp_impressions: miniAppEarnings?.miniapp_impressions || 0,
        miniapp_earnings: miniAppEarnings?.miniapp_earnings || "0.00000000",
        channel_earnings_verified: verifiedChannel?.channel_earnings || "0.00000000",
        bot_count: verifiedBot?.bot_count || 0,
        bot_impressions: verifiedBot?.bot_impressions || 0,
        bot_earnings_verified: verifiedBot?.bot_earnings || "0.00000000",
        referral_count: referralCount?.referral_count || 0,
        referral_earnings_verified: verifiedReferral?.verified_referral_earnings || "0.00000000",
        total_withdrawal_amount: withdrawal?.total_withdrawal_amount || 0,
        withdrawal_count: withdrawal?.withdrawal_count || 0,
        non_referral_earnings: nonReferralEarnings,
        referral_earnings: referralEarnings,
        total_earnings: addReferralDecimals(nonReferralEarnings, referralEarnings),
        earnings_review_complete: false,
        preclearance: null,
        // Durable Verification Fields
        verification_status: ver?.status || "Not Checked",
        verification_task_id: ver?.task_id || null,
        verification_evidence: ver?.evidence || null,
        queue_position: ver?.queue_position || null,
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

/**
 * POST handler for withdrawal verification background tasks and actions.
 */
export async function POST(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").trim();
    const withdrawalId = Number(body.withdrawal_id || body.id || 0);

    if (action === "enqueue_check") {
      if (!Number.isSafeInteger(withdrawalId) || withdrawalId <= 0) {
        return NextResponse.json({ error: "Valid withdrawal_id required" }, { status: 400 });
      }

      const enq = await enqueueWithdrawalVerification(withdrawalId);

      // Complete up to three queued read-only checks in this request. Detached
      // promises may be stopped when the request ends, leaving tasks queued.
      await Promise.allSettled(Array.from({ length: 3 }, (_, index) =>
        processNextVerificationTask(`admin-check-${index}`)
      ));
      const latest = await getLatestVerificationForWithdrawal(withdrawalId);
      return NextResponse.json({
        success: true,
        task_id: latest.task_id ?? enq.task_id,
        status: latest.status,
        queue_position: latest.queue_position,
        evidence: latest.evidence,
      });
    }

    if (action === "get_verification_status") {
      if (!Number.isSafeInteger(withdrawalId) || withdrawalId <= 0) {
        return NextResponse.json({ error: "Valid withdrawal_id required" }, { status: 400 });
      }

      const latest = await getLatestVerificationForWithdrawal(withdrawalId);
      return NextResponse.json({
        success: true,
        ...latest,
      });
    }

    if (action === "process_queue_tick") {
      const result = await processNextVerificationTask();
      return NextResponse.json({
        success: true,
        ...result,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: unknown) {
    console.error("Admin Withdrawals Verification POST Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { admin, response } = await requireAdminPermission("dangerous");
  if (response) return response;

  const { id, action, refund, reason, historical_policy_reviewed } = await request.json();
  if (!id) return NextResponse.json({ error: "Withdrawal ID required" }, { status: 400 });

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [wRows] = await conn.query<WithdrawalRow[]>(`
      SELECT w.id, w.user_id, w.amount, w.idempotency_key, w.status, w.refunded, w.paid_out, w.paid_at, w.network, w.address, w.created_at, u.balance_locked, u.balance_available, u.telegram_id
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
    const amountDecimal = String(withdrawal.amount);
    const currentStatus = withdrawal.status || "pending";
    const wasRefunded = Boolean(withdrawal.refunded);
    const wasPaidOut = Boolean(withdrawal.paid_out) || Boolean(withdrawal.paid_at) || currentStatus === "success";

    if (action === "approve") {
      const amountUnits = parseWithdrawalUnits(String(withdrawal.amount));
      if (amountUnits === null || amountUnits <= BigInt(0)) {
        await conn.rollback();
        return NextResponse.json({ error: "Invalid withdrawal amount", code: "INVALID_WITHDRAWAL_AMOUNT" }, { status: 422 });
      }
      if (currentStatus !== "pending" || wasPaidOut || wasRefunded) {
        await conn.rollback();
        return NextResponse.json({ error: "Only an unpaid, unrefunded pending withdrawal can be approved", code: "WITHDRAWAL_NOT_PAYABLE" }, { status: 409 });
      }
      const destination = validateWithdrawalDestination(withdrawal.network, withdrawal.address);
      if (!destination.ok) {
        await conn.rollback();
        return NextResponse.json({ error: destination.message, code: destination.code }, { status: 422 });
      }
      // Administrator approval is authoritative.
      const historicalPolicyReview = amountUnits < MIN_WITHDRAWAL_UNITS;
      const effectiveReason = String(reason || "").trim() || "Approved by administrator";

      // Optional verification task check: fetch latest verification if present
      const latestVerification = await getLatestVerificationForWithdrawal(Number(id), conn);

      // Verify that user has sufficient balance (locked or available) for payout
      const lockedUnits = parseWithdrawalUnits(String(withdrawal.balance_locked)) ?? BigInt(0);
      const availableUnits = parseWithdrawalUnits(String(withdrawal.balance_available)) ?? BigInt(0);
      if (lockedUnits < amountUnits && lockedUnits + availableUnits < amountUnits) {
        await conn.rollback();
        return NextResponse.json({ error: "User balance is lower than this withdrawal amount", code: "WITHDRAWAL_RESERVATION_UNBACKED" }, { status: 409 });
      }

      const [priorPayout] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM publisher_balance_events WHERE user_id=? AND source_system='withdrawal_payout' AND source_record_id=? LIMIT 1`,
        [withdrawal.user_id, String(id)]
      );
      if (priorPayout.length > 0) {
        await conn.rollback();
        return NextResponse.json({ error: "A prior payout event exists for this withdrawal", code: "WITHDRAWAL_ALREADY_PAID" }, { status: 409 });
      }
      let preclearanceOverride: Awaited<ReturnType<typeof assessWithdrawalPreclearance>> | null = null;
      if (!wasPaidOut) {
        const preclearance = await assessWithdrawalPreclearance(Number(id), conn);
        if (preclearance.state !== "cleared") {
          preclearanceOverride = preclearance;
        }
        if (wasRefunded) {
          const available = toNumber(withdrawal.balance_available);
          if (available < amount) {
            await conn.rollback();
            return NextResponse.json({ error: "User available balance is lower than this refunded withdrawal amount" }, { status: 400 });
          }

          const [availableDebitResult] = await withFinancialPostingContext(conn, {
            sourceKey: `withdrawal:payout:${id}`,
            sourceSystem: "withdrawal_payout",
            sourceRecordId: String(id),
            policyVersion: "withdrawal-payout-v1",
          }, () => conn.query<ResultSetHeader>(
            "UPDATE users SET balance_available = balance_available - ? WHERE id = ? AND balance_available >= ?",
            [amount, withdrawal.user_id, amount]
          ));
          if (availableDebitResult.affectedRows !== 1) {
            await conn.rollback();
            return NextResponse.json({ error: "User available balance is lower than this refunded withdrawal amount" }, { status: 409 });
          }
        } else {
          const locked = toNumber(withdrawal.balance_locked);
          if (locked < amount) {
            await conn.rollback();
            return NextResponse.json({ error: "User locked balance is lower than this withdrawal amount" }, { status: 400 });
          }

          const [lockedDebitResult] = await withFinancialPostingContext(conn, {
            sourceKey: `withdrawal:payout:${id}`,
            sourceSystem: "withdrawal_payout",
            sourceRecordId: String(id),
            policyVersion: "withdrawal-payout-v1",
          }, () => conn.query<ResultSetHeader>(
            "UPDATE users SET balance_locked = balance_locked - ?, total_withdrawn = total_withdrawn + ? WHERE id = ? AND balance_locked >= ?",
            [amount, amount, withdrawal.user_id, amount]
          ));
          if (lockedDebitResult.affectedRows !== 1) {
            await conn.rollback();
            return NextResponse.json({ error: "User locked balance is lower than this withdrawal amount" }, { status: 409 });
          }
        }
      }

      await conn.query("UPDATE withdrawals SET status = 'success', refunded = 0, paid_out = 1, paid_at = COALESCE(paid_at, NOW()) WHERE id = ?", [id]);

      // Update verification task status if one exists
      await conn.query(
        "UPDATE withdrawal_verification_tasks SET status = 'Review Passed', completed_at = COALESCE(completed_at, NOW()) WHERE withdrawal_id = ?",
        [id]
      );

      await conn.commit();

      if (!wasPaidOut) {
        await notifyWithdrawalPaid(withdrawal.telegram_id, { withdrawalId: id, amount, network: withdrawal.network });
      }
      await recordAdminActionAudit({
        adminId: admin?.id,
        action: "withdrawal_approve",
        entityType: "withdrawal",
        entityId: id,
        reason: effectiveReason,
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
          historical_policy_reviewed: historicalPolicyReview,
          historical_policy_basis: effectiveReason,
          verification_task_id: latestVerification.task_id ?? null,
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
      if (wasPaidOut) {
        await conn.rollback();
        return NextResponse.json({ error: "A withdrawal marked paid cannot be rejected or refunded without a separate payment investigation" }, { status: 409 });
      }
      if (currentStatus === "rejected") {
        await conn.rollback();
        return NextResponse.json({ error: "This withdrawal is already rejected. Use the audited refund recovery procedure for any missing refund" }, { status: 409 });
      }
      const shouldRefund = Boolean(refund) && !wasRefunded;

      if (shouldRefund) {
        const amountUnits = parseWithdrawalUnits(amountDecimal);
        const [requestEvents] = await conn.query<Array<RowDataPacket & { delta_available: string; delta_locked: string }>>(
          `SELECT delta_available,delta_locked FROM publisher_balance_events
           WHERE user_id=? AND source_system='withdrawal_request' AND source_record_id=?`,
          [withdrawal.user_id, String(withdrawal.idempotency_key ?? "")]
        );
        const [priorRefundEvents] = await conn.query<RowDataPacket[]>(
          `SELECT id FROM publisher_balance_events WHERE user_id=? AND source_record_id=?
           AND source_system IN ('withdrawal_refund','withdrawal_refund_recovery') LIMIT 1`,
          [withdrawal.user_id, String(id)]
        );
        if (currentStatus !== "pending" || amountUnits === null || requestEvents.length !== 1
          || parseWithdrawalUnits(String(requestEvents[0].delta_available).replace(/^-/u, "")) !== amountUnits
          || !String(requestEvents[0].delta_available).startsWith("-")
          || parseWithdrawalUnits(String(requestEvents[0].delta_locked)) !== amountUnits
          || priorRefundEvents.length > 0) {
          await conn.rollback();
          return NextResponse.json({ error: "Original withdrawal reservation or refund state is not independently verified; use manual financial review" }, { status: 409 });
        }
        const [refundResult] = await withFinancialPostingContext(conn, {
          sourceKey: `withdrawal:refund:${id}`,
          sourceSystem: "withdrawal_refund",
          sourceRecordId: String(id),
          policyVersion: "withdrawal-refund-v1",
        }, () => conn.query<ResultSetHeader>(
          "UPDATE users SET balance_locked = balance_locked - ?, balance_available = balance_available + ? WHERE id = ? AND balance_locked >= ?",
          [amountDecimal, amountDecimal, withdrawal.user_id, amountDecimal]
        ));
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
