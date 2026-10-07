import { NextResponse } from "next/server";
/* eslint-disable @typescript-eslint/no-explicit-any -- legacy withdrawal and settings rows are dynamically shaped */
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthenticatedUserStatus, getAuthErrorStatus } from "@/lib/auth";
import { escapeTelegramHtml } from "@/lib/telegram";
import { requireWithdrawalsAllowed } from "@/lib/productionSafety";
import { withFinancialTransactionRetry } from "@/lib/dbResilience";
import { enqueuePlatformNotification } from "@/lib/platformNotifications";
import { hashUserIdempotencyKey, validateWithdrawalDestination, withdrawalRequestFingerprint } from "@/lib/withdrawalNetworks";
import type { ResultSetHeader } from "mysql2/promise";

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

export async function POST(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const idempotencyRaw = String(request.headers.get("idempotency-key") || "").trim();
    if (idempotencyRaw.length < 16 || idempotencyRaw.length > 128) {
      return NextResponse.json({ error: "A valid Idempotency-Key is required", code: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });
    }
    const body = await request.json();
    const destination = validateWithdrawalDestination(body.network, body.address);
    if (!destination.ok) return NextResponse.json({ error: destination.message, code: destination.code }, { status: 422 });
    const blocked = await requireWithdrawalsAllowed(destination.network);
    if (blocked) return blocked;
    const amountInput = String(body.amount ?? "").trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(amountInput)) {
      return NextResponse.json({ error: "Invalid withdrawal amount", code: "INVALID_WITHDRAWAL_AMOUNT" }, { status: 422 });
    }
    const withdrawAmount = Number(amountInput);
    if (!Number.isFinite(withdrawAmount) || withdrawAmount <= 0 || withdrawAmount <= destination.fee) {
      return NextResponse.json({ error: "Withdrawal amount must exceed the network fee", code: "INVALID_WITHDRAWAL_AMOUNT" }, { status: 422 });
    }
    const amount = withdrawAmount.toFixed(8);
    const fee = destination.fee.toFixed(8);
    const netAmount = (withdrawAmount - destination.fee).toFixed(8);
    const idempotencyKey = hashUserIdempotencyKey(Number(user.id), idempotencyRaw);
    const fingerprint = withdrawalRequestFingerprint({ amount, network: destination.network, address: destination.address });
    const [settingsRows]: any = await pool.query("SELECT `key`, value FROM settings WHERE `key` IN ('min_withdraw', 'max_withdraw')");
    const settings = settingsRows.reduce((acc: any, row: any) => ({ ...acc, [row.key]: Number(row.value) }), {});
    if (withdrawAmount < settings.min_withdraw) return NextResponse.json({ error: `Minimum withdrawal is $${settings.min_withdraw}` }, { status: 400 });
    if (withdrawAmount > settings.max_withdraw) return NextResponse.json({ error: `Maximum withdrawal is $${settings.max_withdraw}` }, { status: 400 });

    const result: any = await withFinancialTransactionRetry(async (connection) => {
      const [[lockedUser]]: any = await connection.query(
        "SELECT balance_available, telegram_id FROM users WHERE id = ? FOR UPDATE", [user.id]
      );
      if (!lockedUser) throw new Error("withdrawal_user_missing");
      const [[existing]]: any = await connection.query(
        "SELECT id, status, request_fingerprint FROM withdrawals WHERE user_id=? AND idempotency_key=? LIMIT 1", [user.id, idempotencyKey]
      );
      if (existing) {
        if (existing.request_fingerprint !== fingerprint) return { error: "Idempotency key was already used for a different withdrawal", code: "IDEMPOTENCY_KEY_CONFLICT", status: 409 };
        return { success: true, withdrawal_id: Number(existing.id), withdrawal_status: existing.status, idempotent: true };
      }
      const [[hold]]: any = await connection.query(
        `SELECT DATE_ADD(updated_at, INTERVAL 10 DAY) hold_until,
          DATE_FORMAT(DATE_ADD(updated_at, INTERVAL 10 DAY), '%e %b %Y') retry_date
         FROM withdrawals WHERE user_id=? AND status='rejected'
          AND updated_at > UTC_TIMESTAMP() - INTERVAL 10 DAY
         ORDER BY updated_at DESC,id DESC LIMIT 1`, [user.id]
      );
      if (hold) return { error: `Withdrawal on hold after a recent rejection. Try again on ${hold.retry_date}.`, code: "WITHDRAWAL_REJECTION_HOLD", hold_until: hold.hold_until, status: 423 };
      if (Number(lockedUser.balance_available || 0) < withdrawAmount) return { error: "Insufficient available balance", status: 400 };
      const [deduction]: any = await connection.query(
        "UPDATE users SET balance_available=balance_available-?, balance_locked=balance_locked+? WHERE id=? AND balance_available>=?",
        [amount, amount, user.id, amount]
      );
      if (deduction.affectedRows !== 1) return { error: "Insufficient available balance", status: 400 };
      const [inserted] = await connection.query<ResultSetHeader>(
        `INSERT INTO withdrawals (user_id,amount,fee,net_amount,network,address,idempotency_key,request_fingerprint,status)
         VALUES (?,?,?,?,?,?,?,?,'pending')`,
        [user.id, amount, fee, netAmount, destination.network, destination.address, idempotencyKey, fingerprint]
      );
      const withdrawalId = Number(inserted.insertId);
      const feeNote = destination.fee > 0 ? `\nNetwork Fee: <b>-$${destination.fee.toFixed(2)}</b>\nYou receive: <b>$${Number(netAmount).toFixed(2)}</b>` : "";
      await enqueuePlatformNotification(connection, {
        eventKey: `withdrawal_submitted:${withdrawalId}`, userId: Number(user.id), eventType: "withdrawal_submitted",
        entityType: "withdrawal", entityId: withdrawalId,
        messageHtml: `🚀 <b>Withdrawal Placed!</b>\n\nAmount: <b>$${withdrawAmount.toFixed(2)}</b>${feeNote}\nNetwork: <b>${escapeTelegramHtml(destination.network)}</b>\nAddress: <code>${escapeTelegramHtml(destination.address)}</code>\n\nYour withdrawal has been placed successfully and will be processed shortly.`,
        metadata: { network: destination.network, amount, net_amount: netAmount },
      });
      return { success: true, withdrawal_id: withdrawalId, withdrawal_status: "pending", idempotent: false };
    }, { operation: "publisher_withdrawal_submit" });
    if (result.error) return NextResponse.json(result, { status: result.status || 400 });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("POST Withdrawal Error:", error);
    return NextResponse.json({ error: "Unable to place withdrawal" }, { status: getAuthErrorStatus(error) });
  }
}
