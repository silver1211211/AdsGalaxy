import { NextResponse } from "next/server";
/* eslint-disable @typescript-eslint/no-explicit-any -- legacy withdrawal and settings rows are dynamically shaped */
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthenticatedUserStatus, getAuthErrorStatus } from "@/lib/auth";
import { escapeTelegramHtml, sendTelegramMessage } from "@/lib/telegram";
import { requireWithdrawalsAllowed } from "@/lib/productionSafety";
import { ensureWithdrawalSubmissionColumns } from "@/lib/schemaGuards";

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUserStatus(initData, { request });

    // Fetch balance and withdrawal history
    const [balanceRows]: any = await pool.query(
      "SELECT balance_available, balance_locked, total_withdrawn FROM users WHERE id = ?",
      [user.id]
    );

    const cursorValue = new URL(request.url).searchParams.get("cursor");
    let cursor: { createdAt: string; id: number } | null = null;
    try {
      const parsed = cursorValue ? JSON.parse(Buffer.from(cursorValue, "base64url").toString("utf8")) : null;
      if (typeof parsed?.createdAt === "string" && Number(parsed.id) > 0) cursor = { createdAt: parsed.createdAt, id: Number(parsed.id) };
    } catch { cursor = null; }
    const [withdrawalRows]: any = await pool.query(
      `SELECT id, amount, fee, net_amount, network, address, status, created_at
       FROM withdrawals WHERE user_id = ?
         AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))
       ORDER BY created_at DESC, id DESC LIMIT 21`,
      [user.id, cursor?.createdAt || null, cursor?.createdAt || null, cursor?.createdAt || null, cursor?.id || 0]
    );
    const hasMore = withdrawalRows.length > 20;
    const withdrawals = withdrawalRows.slice(0, 20);
    const last = withdrawals[withdrawals.length - 1];
    const nextCursor = hasMore && last
      ? Buffer.from(JSON.stringify({ createdAt: new Date(last.created_at).toISOString(), id: Number(last.id) })).toString("base64url")
      : null;

    return NextResponse.json({
      balance: balanceRows[0],
      history: withdrawals,
      has_more: hasMore,
      next_cursor: nextCursor,
    });
  } catch (error: any) {
    console.error("GET Withdrawals Error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch data" }, { status: getAuthErrorStatus(error) });
  }
}

const NETWORK_FEES: Record<string, number> = {
  "TRC-20": 2,
  "ERC-20": 1,
  "BEP-20": 0,
};

export async function POST(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const { amount, network, address } = await request.json();
    const blocked = await requireWithdrawalsAllowed(network);
    if (blocked) return blocked;

    // A rejected withdrawal places the publisher under withdrawal review
    // for 10 days from the rejection time.
    const [rejectionHoldRows]: any = await pool.query(`
      SELECT
        id,
        updated_at,
        DATE_ADD(updated_at, INTERVAL 10 DAY) AS hold_until,
        DATE_FORMAT(DATE_ADD(updated_at, INTERVAL 10 DAY), '%e %b %Y') AS retry_date
      FROM withdrawals
      WHERE user_id = ?
        AND status = 'rejected'
        AND updated_at > UTC_TIMESTAMP() - INTERVAL 10 DAY
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `, [user.id]);

    if (rejectionHoldRows.length > 0) {
      const hold = rejectionHoldRows[0];

      return NextResponse.json({
        error: `Withdrawal on hold after a recent rejection. Try again on ${hold.retry_date}.`,
        code: "WITHDRAWAL_REJECTION_HOLD",
        hold_until: hold.hold_until,
      }, { status: 423 });
    }

    if (!amount || !network || !address) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const withdrawAmount = parseFloat(amount);
    const fee = NETWORK_FEES[network] ?? 0;
    const netAmount = Math.max(0, withdrawAmount - fee);

    // Fetch limits
    const [settingsRows]: any = await pool.query("SELECT \`key\`, value FROM settings WHERE \`key\` IN ('min_withdraw', 'max_withdraw')");
    const settings = settingsRows.reduce((acc: any, row: any) => {
      acc[row.key] = parseFloat(row.value);
      return acc;
    }, {});

    if (withdrawAmount < settings.min_withdraw) {
      return NextResponse.json({ error: `Minimum withdrawal is $${settings.min_withdraw}` }, { status: 400 });
    }
    if (withdrawAmount > settings.max_withdraw) {
      return NextResponse.json({ error: `Maximum withdrawal is $${settings.max_withdraw}` }, { status: 400 });
    }

    // Process Withdrawal (Transactional)
    const connection = await pool.getConnection();
    try {
      await ensureWithdrawalSubmissionColumns(connection);
      await connection.beginTransaction();

      const [userRows]: any = await connection.query(
        "SELECT balance_available, telegram_id FROM users WHERE id = ? FOR UPDATE",
        [user.id]
      );
      const availableBalance = parseFloat(userRows[0]?.balance_available || "0");

      if (availableBalance < withdrawAmount) {
        await connection.rollback();
        return NextResponse.json({ error: "Insufficient available balance" }, { status: 400 });
      }

      // Deduct from available, add to locked (or just record as pending)
      const [deductionResult]: any = await connection.query(
        "UPDATE users SET balance_available = balance_available - ?, balance_locked = balance_locked + ? WHERE id = ? AND balance_available >= ?",
        [withdrawAmount, withdrawAmount, user.id, withdrawAmount]
      );

      if (deductionResult.affectedRows !== 1) {
        await connection.rollback();
        return NextResponse.json({ error: "Insufficient available balance" }, { status: 400 });
      }

      await connection.query(
        "INSERT INTO withdrawals (user_id, amount, fee, net_amount, network, address, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')",
        [user.id, withdrawAmount, fee, netAmount, network, address]
      );

      await connection.commit();

      const feeNote = fee > 0 ? `\nNetwork Fee: <b>-$${fee.toFixed(2)}</b>\nYou receive: <b>$${netAmount.toFixed(2)}</b>` : "";
      const message = `🚀 <b>Withdrawal Placed!</b>\n\n` +
        `Amount: <b>$${withdrawAmount.toFixed(2)}</b>${feeNote}\n` +
        `Network: <b>${escapeTelegramHtml(network)}</b>\n` +
        `Address: <code>${escapeTelegramHtml(address)}</code>\n\n` +
        `Your withdrawal has been placed successfully and will be processed shortly.`;
      
      await sendTelegramMessage(userRows[0].telegram_id, message, { parse_mode: "HTML" });

      return NextResponse.json({ success: true });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error: any) {
    console.error("POST Withdrawal Error:", error);
    return NextResponse.json({ error: error.message || "Failed to place withdrawal" }, { status: getAuthErrorStatus(error) });
  }
}
