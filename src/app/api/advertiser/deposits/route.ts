import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { requireUserWritesAllowed } from "@/lib/productionSafety";
import { OXAPAY_DEPOSIT_NETWORKS, getOxaPayDepositNetwork } from "@/lib/oxapayNetworks";
import type { RowDataPacket } from "mysql2/promise";

const OXAPAY_API_URL = "https://api.oxapay.com/v1/payment/white-label";
const OXAPAY_KEY = process.env.OXAPAY_MERCHANT_API_KEY;
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;

type SettingRow = RowDataPacket & { value: string | null };
type DepositRow = RowDataPacket & {
  id: number;
  track_id: string;
  expired_at: number | null;
};

async function readProviderJson(response: Response) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PROVIDER_RESPONSE_BYTES) throw new Error("provider_response_too_large");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
}

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

    const [rows] = await pool.query<DepositRow[]>(
      `SELECT id, track_id, order_id, amount, pay_amount, currency, pay_currency,
         network, address, status, expired_at, confirmed_at, created_at,
         (SELECT bonus_amount FROM deposit_bonuses WHERE deposit_id = deposits.id) AS bonus_amount,
         (SELECT rate_basis_points FROM deposit_bonuses WHERE deposit_id = deposits.id) AS bonus_rate_basis_points
       FROM deposits WHERE user_id = ? ORDER BY created_at DESC`,
      [user.id]
    );
    const [promotionRows] = await pool.query<Array<RowDataPacket & {
      starts_at: string;
      ends_at: string;
      is_live: number;
    }>>(
      `SELECT starts_at, ends_at, (is_active = TRUE AND starts_at <= UTC_TIMESTAMP() AND UTC_TIMESTAMP() < ends_at) AS is_live
       FROM deposit_promotions WHERE slug = 'deposit-bonus-2026-two-month' LIMIT 1`,
    );

    // Get min deposit from settings
    const [settings] = await pool.query<SettingRow[]>("SELECT value FROM settings WHERE `key` = 'min_deposit_amount'");
    const minDeposit = parseFloat(settings[0]?.value || "5.00");

    return NextResponse.json({ 
      deposits: rows, 
      minDeposit,
      networks: OXAPAY_DEPOSIT_NETWORKS,
      promotion: promotionRows[0] || null,
    });
  } catch (error) {
    return NextResponse.json({ error: "Unable to load deposits" }, { status: getAuthErrorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    const blocked = await requireUserWritesAllowed();
    if (blocked) return blocked;

    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const { amount, network } = await request.json();
    const selectedNetwork = getOxaPayDepositNetwork(network || "BEP20");

    if (!OXAPAY_KEY) {
      return NextResponse.json({ error: "OxaPay merchant API key is not configured" }, { status: 500 });
    }

    if (!selectedNetwork) {
      return NextResponse.json({ error: "Unsupported OxaPay deposit network" }, { status: 400 });
    }

    // Get min deposit from settings
    const [settings] = await pool.query<SettingRow[]>("SELECT value FROM settings WHERE `key` = 'min_deposit_amount'");
    const minDeposit = parseFloat(settings[0]?.value || "5.00");

    const amountText = String(amount ?? "").trim();
    if (!/^\d+(?:\.\d{1,8})?$/.test(amountText) || Number(amountText) < minDeposit) {
      return NextResponse.json({ error: `Minimum deposit amount is $${minDeposit}` }, { status: 400 });
    }

    // Check for pending invoices
    const [pending] = await pool.query<DepositRow[]>(
      `SELECT id, track_id, expired_at
       FROM deposits WHERE user_id = ? AND status IN ('pending', 'waiting', 'paying')`,
      [user.id]
    );

    if (pending.length > 0) {
      // Check if it's really pending or expired
      const now = Math.floor(Date.now() / 1000);
      if (Number(pending[0].expired_at || 0) > now) {
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
        pay_currency: selectedNetwork.currency,
        amount: amountText,
        currency: "USD",
        to_currency: "USDT",
        network: selectedNetwork.oxapayNetwork,
        lifetime: 60,
        order_id: order_id,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await readProviderJson(response).catch(() => null);

    if (!data || data.status !== 200) {
      return NextResponse.json({ error: "Payment provider could not create the deposit" }, { status: 502 });
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
  } catch (error) {
    console.error("Deposit Error:", error);
    return NextResponse.json({ error: "Unable to create deposit" }, { status: getAuthErrorStatus(error) });
  }
}
