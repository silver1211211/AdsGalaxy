import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { columnExists } from "@/lib/schemaGuards";
import type { RowDataPacket } from "mysql2/promise";

const OXAPAY_STATUS_URL = "https://api.oxapay.com/v1/payment/";
const OXAPAY_KEY = process.env.OXAPAY_MERCHANT_API_KEY;

type DepositRow = RowDataPacket & {
  id: number;
  track_id: string;
  order_id: string;
  amount: number;
  pay_amount: number;
  currency: string | null;
  pay_currency: string | null;
  network: string | null;
  status: string;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Internal Server Error";
}

function toNumber(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function getNestedNumber(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const amount = toNumber(source[key]);
    if (amount > 0) return amount;
  }
  return 0;
}

function extractConvertedUsdtAmount(remote: Record<string, unknown>, fallbackAmount: number) {
  const directAmount = getNestedNumber(remote, [
    "received_usdt",
    "received_amount_usdt",
    "converted_amount",
    "to_amount",
    "credited_amount",
  ]);
  if (directAmount > 0 && String(remote.to_currency || remote.currency || "").toUpperCase() === "USDT") {
    return directAmount;
  }

  const txs = Array.isArray(remote.txs) ? remote.txs : [];
  const convertedFromTxs = txs.reduce((sum, tx) => {
    if (!tx || typeof tx !== "object") return sum;
    const txRecord = tx as Record<string, unknown>;
    const conversion = txRecord.auto_convert;
    if (conversion && typeof conversion === "object") {
      const conversionRecord = conversion as Record<string, unknown>;
      const conversionCurrency = String(conversionRecord.currency || conversionRecord.to_currency || "").toUpperCase();
      const conversionAmount = getNestedNumber(conversionRecord, ["amount", "received_amount", "credited_amount"]);
      if (conversionCurrency === "USDT" && conversionAmount > 0) {
        return sum + conversionAmount;
      }
    }
    return sum;
  }, 0);

  return convertedFromTxs > 0 ? convertedFromTxs : fallbackAmount;
}

async function ensureDepositStatusSchema() {
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
  await pool.query(
    `CREATE TABLE IF NOT EXISTS advertiser_transactions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT NOT NULL,
      amount DECIMAL(18,8) NOT NULL DEFAULT 0,
      type VARCHAR(30) NOT NULL,
      description TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_advertiser_transactions_user (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ track_id: string }> }
) {
  try {
    const { track_id } = await params;
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    await ensureDepositStatusSchema();

    const [rows] = await pool.query<DepositRow[]>(
      `SELECT id, track_id, order_id, amount, pay_amount, currency, pay_currency,
         network, address, status, expired_at, created_at
       FROM deposits WHERE track_id = ? AND user_id = ?`,
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

    const remote = data.data as Record<string, unknown>;
    const newStatus = String(remote.status || deposit.status); // pending, paid, expired, etc.
    const txn_id = Array.isArray(remote.txs) && remote.txs.length > 0 ? JSON.stringify(remote.txs) : null;

    if (newStatus === "paid" && deposit.status !== "paid") {
      const creditAmount = extractConvertedUsdtAmount(remote, toNumber(deposit.amount));
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        // 1. Update deposit status
        await conn.query(
          "UPDATE deposits SET status = ?, txn_id = ?, amount = ?, currency = 'USDT' WHERE id = ?",
          ["paid", txn_id, creditAmount, deposit.id]
        );

        // 2. Add to user balance
        await conn.query(
          "UPDATE users SET ad_balance = ad_balance + ? WHERE id = ?",
          [creditAmount, user.id]
        );

        // 3. Log transaction
        await conn.query(
          "INSERT INTO advertiser_transactions (user_id, amount, type, description) VALUES (?, ?, 'credit', ?)",
          [user.id, creditAmount, `Deposit via OxaPay converted to USDT (Order: ${deposit.order_id})`]
        );

        await conn.commit();
        deposit.status = "paid";
        deposit.amount = creditAmount;
        deposit.currency = "USDT";
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
  } catch (error) {
    console.error("Deposit Status Check Error:", error);
    return NextResponse.json({ error: errorMessage(error) }, { status: getAuthErrorStatus(error) });
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
    await ensureDepositStatusSchema();
    const { action } = await request.json();

    if (action === "cancel") {
      await pool.query(
        "UPDATE deposits SET status = 'canceled' WHERE track_id = ? AND user_id = ? AND status IN ('pending', 'waiting')",
        [track_id, user.id]
      );
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: getAuthErrorStatus(error) });
  }
}
