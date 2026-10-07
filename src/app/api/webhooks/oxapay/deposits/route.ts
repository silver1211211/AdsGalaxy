import { createHmac, timingSafeEqual } from "node:crypto";
import pool from "@/lib/db";
import { confirmDepositCredit } from "@/lib/depositBonus";
import { reactivateInsufficientBalanceCampaigns } from "@/lib/directDebitLifecycle";
import type { RowDataPacket } from "mysql2/promise";

const MAX_WEBHOOK_BYTES = 64 * 1024;
function safeSignatureEqual(actual: string, expected: string) {
  if (!/^[a-f0-9]{128}$/i.test(actual)) return false;
  const left = Buffer.from(actual.toLowerCase(), "hex");
  const right = Buffer.from(expected.toLowerCase(), "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}
function decimal(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d+(?:\.\d{1,8})?$/.test(text) && Number(text) > 0 ? text : "";
}

export async function POST(request: Request) {
  const key = process.env.OXAPAY_MERCHANT_API_KEY || "";
  const length = Number(request.headers.get("content-length") || 0);
  if (!key || length > MAX_WEBHOOK_BYTES) return new Response("invalid", { status: 400 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_WEBHOOK_BYTES) return new Response("invalid", { status: 400 });
  const expected = createHmac("sha512", key).update(raw).digest("hex");
  if (!safeSignatureEqual(String(request.headers.get("hmac") || ""), expected)) return new Response("invalid", { status: 401 });
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(raw); } catch { return new Response("invalid", { status: 400 }); }
  const trackId = String(payload.track_id || "").trim();
  const orderId = String(payload.order_id || "").trim();
  if (!trackId && !orderId) return new Response("ok");
  const [rows] = await pool.query<Array<RowDataPacket & { id: number; user_id: number; amount: string; status: string }>>(
    "SELECT id,user_id,amount,status FROM deposits WHERE track_id=? OR order_id=? ORDER BY id DESC LIMIT 1", [trackId || null, orderId || null]
  );
  const deposit = rows[0];
  if (!deposit) return new Response("ok");
  const providerStatus = String(payload.status || "").toLowerCase();
  await pool.query("UPDATE deposits SET provider_status=? WHERE id=?", [providerStatus || null, deposit.id]);
  if (providerStatus === "paid") {
    const confirmedAmount = decimal(payload.received_usdt) || decimal(payload.converted_amount) || decimal(payload.amount) || String(deposit.amount);
    const transaction = Array.isArray(payload.txs) ? JSON.stringify(payload.txs) : null;
    await confirmDepositCredit(pool, { depositId: deposit.id, userId: deposit.user_id, confirmedAmount,
      providerTransaction: transaction, confirmedAt: new Date() });
    await reactivateInsufficientBalanceCampaigns(deposit.user_id).catch(() => undefined);
  } else if (["expired", "failed", "cancelled"].includes(providerStatus)) {
    await pool.query("UPDATE deposits SET status=? WHERE id=? AND status<>'paid'", [providerStatus === "cancelled" ? "canceled" : providerStatus, deposit.id]);
  }
  return new Response("ok");
}
