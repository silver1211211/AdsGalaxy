import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { requireUserWritesAllowed } from "@/lib/productionSafety";
import { OXAPAY_DEPOSIT_NETWORKS, getOxaPayDepositNetwork } from "@/lib/oxapayNetworks";
import { columnExists } from "@/lib/schemaGuards";
import type { RowDataPacket } from "mysql2/promise";

const OXAPAY_API_URL = "https://api.oxapay.com/v1/payment/white-label";
const OXAPAY_KEY = process.env.OXAPAY_MERCHANT_API_KEY;

type SettingRow = RowDataPacket & { value: string | null };
type DepositRow = RowDataPacket & {
  id: number;
  track_id: string;
  expired_at: number | null;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Internal Server Error";
}

async function ensureDepositSchema() {
  const columns: Array<[string, string]> = [
    ["user_id", "INT NULL"],
    ["track_id", "VARCHAR(255) NULL"],
    ["order_id", "VARCHAR(255) NULL"],
    ["amount", "DECIMAL(18,8) NOT NULL DEFAULT 0"],
    ["pay_amount", "DECIMAL(18,8) NOT NULL DEFAULT 0"],
    ["currency", "VARCHAR(20) NULL"],
    ["pay_currency", "VARCHAR(20) NULL"],
    ["network", "VARCHAR(50) NULL"],
    ["address", "TEXT NULL"],
    ["status", "VARCHAR(50) NOT NULL DEFAULT 'pending'"],
    ["expired_at", "BIGINT NULL"],
    ["txn_id", "TEXT NULL"],
  ];

  for (const [column, definition] of columns) {
    if (!(await columnExists(pool, "deposits", column))) {
      await pool.query(`ALTER TABLE deposits ADD COLUMN \`${column}\` ${definition}`);
    }
  }
}

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    await ensureDepositSchema();

    // Auto-cancel expired deposits
    const now = Math.floor(Date.now() / 1000);
    await pool.query(
      "UPDATE deposits SET status = 'expired' WHERE user_id = ? AND status IN ('pending', 'waiting', 'paying') AND expired_at < ?",
      [user.id, now]
    );

    const [rows] = await pool.query<DepositRow[]>(
      `SELECT id, track_id, order_id, amount, pay_amount, currency, pay_currency,
         network, address, status, expired_at, created_at
       FROM deposits WHERE user_id = ? ORDER BY created_at DESC`,
      [user.id]
    );

    // Get min deposit from settings
    const [settings] = await pool.query<SettingRow[]>("SELECT value FROM settings WHERE `key` = 'min_deposit_amount'");
    const minDeposit = parseFloat(settings[0]?.value || "5.00");

    return NextResponse.json({ 
      deposits: rows, 
      minDeposit,
      networks: OXAPAY_DEPOSIT_NETWORKS,
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: getAuthErrorStatus(error) });
  }
}

export async function POST(request: Request) {
  try {
    const blocked = await requireUserWritesAllowed();
    if (blocked) return blocked;

    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    await ensureDepositSchema();
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

    if (!amount || isNaN(amount) || amount < minDeposit) {
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
        amount: parseFloat(amount),
        currency: "USD",
        to_currency: "USDT",
        network: selectedNetwork.oxapayNetwork,
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
  } catch (error) {
    console.error("Deposit Error:", error);
    return NextResponse.json({ error: errorMessage(error) }, { status: getAuthErrorStatus(error) });
  }
}
