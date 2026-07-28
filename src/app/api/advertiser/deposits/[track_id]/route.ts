import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import type { RowDataPacket } from "mysql2/promise";
import { confirmDepositCredit } from "@/lib/depositBonus";

const OXAPAY_STATUS_URL = "https://api.oxapay.com/v1/payment/";
const OXAPAY_KEY = process.env.OXAPAY_MERCHANT_API_KEY;
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;

type DepositRow = RowDataPacket & {
  id: number;
  track_id: string;
  order_id: string;
  amount: string;
  pay_amount: string;
  currency: string | null;
  pay_currency: string | null;
  network: string | null;
  status: string;
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

function getNestedDecimal(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const amount = String(source[key] ?? "").trim();
    if (/^\d+(?:\.\d{1,8})?$/.test(amount) && Number(amount) > 0) return amount;
  }
  return "";
}

function addDecimals(left: string, right: string) {
  const units = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * BigInt(100_000_000) + BigInt((fraction + "00000000").slice(0, 8));
  };
  const total = units(left) + units(right);
  return `${total / BigInt(100_000_000)}.${(total % BigInt(100_000_000)).toString().padStart(8, "0")}`;
}

function extractConvertedUsdtAmount(remote: Record<string, unknown>, fallbackAmount: string) {
  const directAmount = getNestedDecimal(remote, [
    "received_usdt",
    "received_amount_usdt",
    "converted_amount",
    "to_amount",
    "credited_amount",
  ]);
  if (directAmount && String(remote.to_currency || remote.currency || "").toUpperCase() === "USDT") {
    return directAmount;
  }

  const txs = Array.isArray(remote.txs) ? remote.txs : [];
  const convertedFromTxs = txs.reduce((sum: string, tx) => {
    if (!tx || typeof tx !== "object") return sum;
    const txRecord = tx as Record<string, unknown>;
    const conversion = txRecord.auto_convert;
    if (conversion && typeof conversion === "object") {
      const conversionRecord = conversion as Record<string, unknown>;
      const conversionCurrency = String(conversionRecord.currency || conversionRecord.to_currency || "").toUpperCase();
      const conversionAmount = getNestedDecimal(conversionRecord, ["amount", "received_amount", "credited_amount"]);
      if (conversionCurrency === "USDT" && conversionAmount) {
        return addDecimals(sum, conversionAmount);
      }
    }
    return sum;
  }, "0.00000000");

  return convertedFromTxs !== "0.00000000" ? convertedFromTxs : fallbackAmount;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ track_id: string }> }
) {
  try {
    const { track_id } = await params;
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    const [rows] = await pool.query<DepositRow[]>(
      `SELECT id, track_id, order_id, amount, pay_amount, currency, pay_currency,
       network, address, status, expired_at, confirmed_at, created_at,
       (SELECT bonus_amount FROM deposit_bonuses WHERE deposit_id = deposits.id) AS bonus_amount,
       (SELECT rate_basis_points FROM deposit_bonuses WHERE deposit_id = deposits.id) AS bonus_rate_basis_points
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
      signal: AbortSignal.timeout(15_000),
    });

    const data = await readProviderJson(response).catch(() => null);

    if (!data || data.status !== 200) {
      return NextResponse.json({ error: "Payment provider status is unavailable" }, { status: 502 });
    }

    const remote = data.data as Record<string, unknown>;
    const newStatus = String(remote.status || deposit.status); // pending, paid, expired, etc.
    const txn_id = Array.isArray(remote.txs) && remote.txs.length > 0 ? JSON.stringify(remote.txs) : null;

    if (newStatus === "paid" && deposit.status !== "paid") {
      const creditAmount = extractConvertedUsdtAmount(remote, String(deposit.amount));
      const confirmedAt = new Date();
      const confirmation = await confirmDepositCredit(pool, {
        depositId: deposit.id,
        userId: user.id,
        confirmedAmount: creditAmount,
        providerTransaction: txn_id,
        confirmedAt,
      });
      deposit.status = "paid";
      deposit.amount = confirmation.principalAmount;
      deposit.currency = "USDT";
      Object.assign(deposit, {
        confirmed_at: confirmedAt,
        bonus_amount: confirmation.bonusAmount,
        bonus_rate_basis_points: confirmation.rateBasisPoints,
      });
    } else if (newStatus !== deposit.status) {
      await pool.query("UPDATE deposits SET status = ? WHERE id = ?", [newStatus, deposit.id]);
      deposit.status = newStatus;
    }

    return NextResponse.json(deposit);
  } catch (error) {
    console.error("Deposit Status Check Error:", error);
    return NextResponse.json({ error: "Unable to check deposit status" }, { status: getAuthErrorStatus(error) });
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
  } catch (error) {
    return NextResponse.json({ error: "Unable to update deposit" }, { status: getAuthErrorStatus(error) });
  }
}
