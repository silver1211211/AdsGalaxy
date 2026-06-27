import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { requireUserWritesAllowed } from "@/lib/productionSafety";

const OXAPAY_API_URL = "https://api.oxapay.com/v1/payment/white-label";
const OXAPAY_KEY = process.env.OXAPAY_MERCHANT_API_KEY;

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    // Auto-cancel expired deposits
    const now = Math.floor(Date.now() / 1000);
    await pool.query(
      "UPDATE deposits SET status = 'expired' WHERE user_id = ? AND status IN ('pending', 'waiting', 'paying') AND expired_at < ?",
      [user.id, now]
    );

    const [rows]: any = await pool.query(
      "SELECT * FROM deposits WHERE user_id = ? ORDER BY created_at DESC",
      [user.id]
    );

    // Get min deposit from settings
    const [settings]: any = await pool.query("SELECT value FROM settings WHERE `key` = 'min_deposit_amount'");
    const minDeposit = parseFloat(settings[0]?.value || "5.00");

    return NextResponse.json({ 
      deposits: rows, 
      minDeposit 
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: getAuthErrorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    const blocked = await requireUserWritesAllowed();
    if (blocked) return blocked;

    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const { amount, network } = await request.json();

    // Get min deposit from settings
    const [settings]: any = await pool.query("SELECT value FROM settings WHERE `key` = 'min_deposit_amount'");
    const minDeposit = parseFloat(settings[0]?.value || "5.00");

    if (!amount || isNaN(amount) || amount < minDeposit) {
      return NextResponse.json({ error: `Minimum deposit amount is $${minDeposit}` }, { status: 400 });
    }

    // Check for pending invoices
    const [pending]: any = await pool.query(
      "SELECT * FROM deposits WHERE user_id = ? AND status IN ('pending', 'waiting', 'paying')",
      [user.id]
    );

    if (pending.length > 0) {
      // Check if it's really pending or expired
      const now = Math.floor(Date.now() / 1000);
      if (pending[0].expired_at > now) {
        return NextResponse.json({ 
          error: "You have a pending deposit. Please pay or wait for it to expire.",
          pending_track_id: pending[0].track_id 
        }, { status: 400 });
      } else {
        // Mark as expired and continue
        await pool.query("UPDATE deposits SET status = 'expired' WHERE id = ?", [pending[0].id]);
      }
    }

    const order_id = `DEP-${Date.now()}-${user.id}`;

    const response = await fetch(OXAPAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "merchant_api_key": OXAPAY_KEY || "",
      },
      body: JSON.stringify({
        pay_currency: "USDT",
        amount: parseFloat(amount),
        currency: "USDT",
        network: network || "BEP20",
        lifetime: 60,
        order_id: order_id,
      }),
    });

    const data = await response.json();

    if (data.status !== 200) {
      return NextResponse.json({ error: data.message || "OxaPay API Error" }, { status: 400 });
    }

    const invoice = data.data;

    await pool.query(
      `INSERT INTO deposits (user_id, track_id, order_id, amount, pay_amount, currency, pay_currency, network, address, status, expired_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        invoice.track_id,
        invoice.order_id,
        invoice.amount,
        invoice.pay_amount,
        invoice.currency,
        invoice.pay_currency,
        invoice.network,
        invoice.address,
        invoice.status || "waiting",
        invoice.expired_at,
      ]
    );

    return NextResponse.json(invoice);
  } catch (error: any) {
    console.error("Deposit Error:", error);
    return NextResponse.json({ error: error.message }, { status: getAuthErrorStatus(error) });
  }
}
