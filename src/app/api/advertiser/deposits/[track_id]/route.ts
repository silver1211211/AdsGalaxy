import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";

const OXAPAY_STATUS_URL = "https://api.oxapay.com/v1/payment/";
const OXAPAY_KEY = process.env.OXAPAY_MERCHANT_API_KEY;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ track_id: string }> }
) {
  try {
    const { track_id } = await params;
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    const [rows]: any = await pool.query(
      "SELECT * FROM deposits WHERE track_id = ? AND user_id = ?",
      [track_id, user.id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Deposit not found" }, { status: 404 });
    }

    const deposit = rows[0];

    // If already finalized, just return
    if (deposit.status === "paid" || deposit.status === "expired" || deposit.status === "canceled") {
      return NextResponse.json(deposit);
    }

    // Call OxaPay to check real status
    const response = await fetch(`${OXAPAY_STATUS_URL}${track_id}`, {
      headers: {
        "merchant_api_key": OXAPAY_KEY || "",
      },
    });

    const data = await response.json();

    if (data.status !== 200) {
      return NextResponse.json({ error: data.message || "OxaPay API Error" }, { status: 400 });
    }

    const remote = data.data;
    const newStatus = remote.status; // pending, paid, expired, etc.
    const txn_id = remote.txs && remote.txs.length > 0 ? JSON.stringify(remote.txs) : null;

    if (newStatus === "paid" && deposit.status !== "paid") {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        // 1. Update deposit status
        await conn.query(
          "UPDATE deposits SET status = ?, txn_id = ? WHERE id = ?",
          ["paid", txn_id, deposit.id]
        );

        // 2. Add to user balance
        await conn.query(
          "UPDATE users SET ad_balance = ad_balance + ? WHERE id = ?",
          [deposit.amount, user.id]
        );

        // 3. Log transaction
        await conn.query(
          "INSERT INTO advertiser_transactions (user_id, amount, type, description) VALUES (?, ?, 'credit', ?)",
          [user.id, deposit.amount, `Deposit via OxaPay (Order: ${deposit.order_id})`]
        );

        await conn.commit();
        deposit.status = "paid";
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    } else if (newStatus !== deposit.status) {
      await pool.query("UPDATE deposits SET status = ? WHERE id = ?", [newStatus, deposit.id]);
      deposit.status = newStatus;
    }

    return NextResponse.json(deposit);
  } catch (error: any) {
    console.error("Deposit Status Check Error:", error);
    return NextResponse.json({ error: error.message }, { status: getAuthErrorStatus(error) });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ track_id: string }> }
) {
  try {
    const { track_id } = await params;
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const { action } = await request.json();

    if (action === "cancel") {
      await pool.query(
        "UPDATE deposits SET status = 'canceled' WHERE track_id = ? AND user_id = ? AND status IN ('pending', 'waiting')",
        [track_id, user.id]
      );
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: getAuthErrorStatus(error) });
  }
}
