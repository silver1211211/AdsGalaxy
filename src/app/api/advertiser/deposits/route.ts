import { NextResponse } from "next/server";
/* eslint-disable @typescript-eslint/no-explicit-any -- transactional provider rows are dynamically shaped */
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthenticatedUserStatus, getAuthErrorStatus } from "@/lib/auth";
import { requireUserWritesAllowed } from "@/lib/productionSafety";
import { OXAPAY_DEPOSIT_NETWORKS, getOxaPayDepositNetwork } from "@/lib/oxapayNetworks";
import type { RowDataPacket } from "mysql2/promise";
import { MAX_DEPOSIT_AMOUNT, validateDepositAmount, validateProviderPayAmount } from "@/lib/depositAmountValidation";

import { createHash } from "node:crypto";
import { withFinancialTransactionRetry } from "@/lib/dbResilience";
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
    const user = await getAuthenticatedUserStatus(initData, { request });

    // Reflect expiry without mutating state during a read-only navigation.
    const now = Math.floor(Date.now() / 1000);

    const cursorValue = new URL(request.url).searchParams.get("cursor");
    let cursor: { createdAt: string; id: number } | null = null;
    try {
      const parsed = cursorValue ? JSON.parse(Buffer.from(cursorValue, "base64url").toString("utf8")) : null;
      if (typeof parsed?.createdAt === "string" && Number(parsed.id) > 0) cursor = { createdAt: parsed.createdAt, id: Number(parsed.id) };
    } catch { cursor = null; }
    const [depositRows] = await pool.query<DepositRow[]>(
      `SELECT id, track_id, order_id, amount, pay_amount, currency, pay_currency,
         network, address,
         CASE WHEN status IN ('pending','waiting','paying') AND expired_at < ? THEN 'expired' WHEN local_canceled_at IS NOT NULL AND status<>'paid' THEN 'canceled' ELSE status END status,
         expired_at, confirmed_at, created_at,
         (SELECT bonus_amount FROM deposit_bonuses WHERE deposit_id = deposits.id) AS bonus_amount,
         (SELECT rate_basis_points FROM deposit_bonuses WHERE deposit_id = deposits.id) AS bonus_rate_basis_points
       FROM deposits WHERE user_id = ?
         AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))
       ORDER BY created_at DESC, id DESC LIMIT 21`,
      [now, user.id, cursor?.createdAt || null, cursor?.createdAt || null, cursor?.createdAt || null, cursor?.id || 0]
    );
    const hasMore = depositRows.length > 20;
    const rows = depositRows.slice(0, 20);
    const last = rows[rows.length - 1] as (DepositRow & { created_at?: Date | string }) | undefined;
    const nextCursor = hasMore && last
      ? Buffer.from(JSON.stringify({ createdAt: new Date(last.created_at!).toISOString(), id: Number(last.id) })).toString("base64url")
      : null;
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
      maxDeposit: MAX_DEPOSIT_AMOUNT,
      networks: OXAPAY_DEPOSIT_NETWORKS,
      promotion: promotionRows[0] || null,
      has_more: hasMore,
      next_cursor: nextCursor,
    });
  } catch (error) {
    return NextResponse.json({ error: "Unable to load deposits" }, { status: getAuthErrorStatus(error) });
  }
}

export async function POST(request: Request) {
  let reservationId: number | null = null;
  try {
    const blocked = await requireUserWritesAllowed();
    if (blocked) return blocked;
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const rawKey = String(request.headers.get("idempotency-key") || "").trim();
    if (rawKey.length < 16 || rawKey.length > 128) {
      return NextResponse.json({ error: "A valid Idempotency-Key is required", code: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });
    }
    const { amount, network } = await request.json();
    const selectedNetwork = getOxaPayDepositNetwork(network || "BEP20");
    if (!OXAPAY_KEY) return NextResponse.json({ error: "OxaPay merchant API key is not configured" }, { status: 500 });
    if (!selectedNetwork) return NextResponse.json({ error: "Unsupported OxaPay deposit network" }, { status: 400 });
    const [settings] = await pool.query<SettingRow[]>("SELECT value FROM settings WHERE `key`='min_deposit_amount'");
    const minDeposit = Number(settings[0]?.value || "5.00");
    const validation = validateDepositAmount(amount, minDeposit);
    if (!validation.ok) return NextResponse.json({ error: validation.message, code: validation.code }, { status: 422 });
    const amountText = validation.normalized;
    const keyHash = createHash("sha256").update(`${user.id}:${rawKey}`).digest("hex");
    const fingerprint = createHash("sha256").update(`${amountText}|${selectedNetwork.currency}|${selectedNetwork.oxapayNetwork}`).digest("hex");
    const orderId = `DEP-${user.id}-${keyHash.slice(0, 32)}`;
    const reserved: any = await withFinancialTransactionRetry(async (connection) => {
      await connection.query("SELECT id FROM users WHERE id=? FOR UPDATE", [user.id]);
      const [[existing]]: any = await connection.query(
        `SELECT id,track_id,order_id,amount,pay_amount,currency,pay_currency,network,address,status,expired_at,
          creation_request_fingerprint,creation_state FROM deposits WHERE user_id=? AND creation_idempotency_key=? LIMIT 1`,
        [user.id, keyHash]
      );
      if (existing) {
        if (existing.creation_request_fingerprint !== fingerprint) return { conflict: true };
        return { existing };
      }
      const [[active]]: any = await connection.query(
        `SELECT id,track_id FROM deposits WHERE user_id=? AND status IN ('pending','waiting','paying')
          AND (expired_at IS NULL OR expired_at>UNIX_TIMESTAMP()) ORDER BY id DESC LIMIT 1 FOR UPDATE`, [user.id]
      );
      if (active) return { pending: true, track_id: active.track_id };
      const [inserted]: any = await connection.query(
        `INSERT INTO deposits (user_id,track_id,order_id,amount,currency,pay_currency,network,status,expired_at,
          creation_idempotency_key,creation_request_fingerprint,creation_state,provider_status)
         VALUES (?,NULL,?,?,?,?,?,'waiting',UNIX_TIMESTAMP()+3600,?,?, 'reserved','creating')`,
        [user.id, orderId, amountText, "USD", selectedNetwork.currency, selectedNetwork.oxapayNetwork, keyHash, fingerprint]
      );
      return { created: true, id: Number(inserted.insertId) };
    }, { operation: "deposit_invoice_reservation" });
    if (reserved.conflict) return NextResponse.json({ error: "Idempotency key was already used for different deposit details", code: "IDEMPOTENCY_KEY_CONFLICT" }, { status: 409 });
    if (reserved.pending) return NextResponse.json({ error: "You have a pending deposit. Please pay or wait for it to expire.", pending_track_id: reserved.track_id }, { status: 409 });
    if (reserved.existing) {
      const existing = reserved.existing;
      if (existing.creation_state === "provisioned") return NextResponse.json(existing);
      return NextResponse.json({ error: "Deposit creation is already being reconciled. Retry status shortly.", code: "DEPOSIT_CREATION_IN_PROGRESS", order_id: existing.order_id }, { status: 202 });
    }
    reservationId = reserved.id;
    const callbackUrl = new URL("/api/webhooks/oxapay/deposits", process.env.NEXT_PUBLIC_APP_URL || request.url).toString();
    const response = await fetch(OXAPAY_API_URL, {
      method: "POST", headers: { "Content-Type": "application/json", merchant_api_key: OXAPAY_KEY },
      body: JSON.stringify({ pay_currency: selectedNetwork.currency, amount: amountText, currency: "USD", to_currency: "USDT",
        network: selectedNetwork.oxapayNetwork, lifetime: 60, order_id: orderId, callback_url: callbackUrl }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await readProviderJson(response).catch(() => null);
    if (!data || data.status !== 200) {
      await pool.query("UPDATE deposits SET creation_state='failed',provider_status='creation_failed',status='expired' WHERE id=? AND creation_state='reserved'", [reservationId]);
      return NextResponse.json({ error: "Payment provider could not create the deposit" }, { status: 502 });
    }
    const invoice = data.data;
    if (!invoice || String(invoice.order_id || "") !== orderId || !validateProviderPayAmount(invoice.pay_amount) || !validateDepositAmount(invoice.amount, minDeposit).ok) {
      await pool.query("UPDATE deposits SET creation_state='failed',provider_status='invalid_provider_response',status='expired' WHERE id=?", [reservationId]);
      return NextResponse.json({ error: "Payment provider returned an invalid deposit invoice" }, { status: 502 });
    }
    await pool.query(
      `UPDATE deposits SET track_id=?,pay_amount=?,currency=?,pay_currency=?,network=?,address=?,status=?,provider_status=?,expired_at=?,creation_state='provisioned'
       WHERE id=? AND user_id=? AND creation_state='reserved'`,
      [invoice.track_id, invoice.pay_amount, invoice.currency, invoice.pay_currency, invoice.network, invoice.address,
        invoice.status || "waiting", invoice.status || "waiting", invoice.expired_at, reservationId, user.id]
    );
    return NextResponse.json(invoice);
  } catch (error) {
    if (reservationId) await pool.query("UPDATE deposits SET creation_state='ambiguous',provider_status='creation_unknown' WHERE id=? AND creation_state='reserved'", [reservationId]).catch(() => undefined);
    console.error("Deposit Error:", error);
    return NextResponse.json({ error: "Unable to create deposit" }, { status: getAuthErrorStatus(error) });
  }
}
