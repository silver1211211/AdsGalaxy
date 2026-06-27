import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { sendTelegramMessage } from "@/lib/telegram";
import { requireWithdrawalsAllowed } from "@/lib/productionSafety";
import { ensureWithdrawalSubmissionColumns } from "@/lib/schemaGuards";

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    // Fetch balance and withdrawal history
    const [balanceRows]: any = await pool.query(
      "SELECT balance_available, balance_locked, total_withdrawn FROM users WHERE id = ?",
      [user.id]
    );

    const [withdrawals]: any = await pool.query(
      "SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC",
      [user.id]
    );

    return NextResponse.json({
      balance: balanceRows[0],
      history: withdrawals
    });
  } catch (error: any) {
    console.error("GET Withdrawals Error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch data" }, { status: getAuthErrorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const { amount, network, address } = await request.json();
    const blocked = await requireWithdrawalsAllowed(network);
    if (blocked) return blocked;

    if (!amount || !network || !address) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const withdrawAmount = parseFloat(amount);

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
        "INSERT INTO withdrawals (user_id, amount, network, address, status) VALUES (?, ?, ?, ?, 'pending')",
        [user.id, withdrawAmount, network, address]
      );

      await connection.commit();

      // Send Telegram Notification
      const message = `🚀 <b>Withdrawal Placed!</b>\n\n` +
        `Amount: <b>$${withdrawAmount.toFixed(2)}</b>\n` +
        `Network: <b>${network}</b>\n` +
        `Address: <code>${address}</code>\n\n` +
        `Your withdrawal has been placed successfully and will be processed shortly.`;
      
      await sendTelegramMessage(userRows[0].telegram_id, message);

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
