import { createHash } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
}
export function campaignCreateFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
export async function campaignFormDataFingerprint(formData: FormData) {
  const entries: Array<[string, unknown]> = [];
  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      entries.push([key, { name: value.name, type: value.type, size: value.size,
        sha256: createHash("sha256").update(Buffer.from(await value.arrayBuffer())).digest("hex") }]);
    } else entries.push([key, String(value)]);
  }
  entries.sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || JSON.stringify(av).localeCompare(JSON.stringify(bv)));
  return campaignCreateFingerprint(entries);
}

export type CampaignCreateReservation =
  | { outcome: "acquired"; id: number }
  | { outcome: "replay"; id: number; response: Record<string, unknown> }
  | { outcome: "conflict" }
  | { outcome: "in_progress" };

export async function reserveCampaignCreate(input: { advertiserId: number; operation: "campaign" | "miniapp"; rawKey: string; fingerprint: string }): Promise<CampaignCreateReservation> {
  const rawKey = input.rawKey.trim();
  if (rawKey.length < 16 || rawKey.length > 128) throw Object.assign(new Error("A valid Idempotency-Key is required"), { code: "IDEMPOTENCY_KEY_REQUIRED", status: 400 });
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [inserted] = await conn.query<import("mysql2/promise").ResultSetHeader>(
      `INSERT IGNORE INTO campaign_create_requests(advertiser_id,operation_name,idempotency_key,request_fingerprint,state)
       VALUES (?,?,?,?,'processing')`, [input.advertiserId, input.operation, keyHash, input.fingerprint]
    );
    const [rows] = await conn.query<Array<RowDataPacket & { id: number; request_fingerprint: string; state: string; response_json: string | Record<string, unknown> | null; stale:number }>>(
      "SELECT id,request_fingerprint,state,response_json,(updated_at<NOW()-INTERVAL 10 MINUTE) stale FROM campaign_create_requests WHERE advertiser_id=? AND operation_name=? AND idempotency_key=? FOR UPDATE",
      [input.advertiserId, input.operation, keyHash]
    );
    const row = rows[0];
    if (!row) throw new Error("campaign_create_reservation_missing");
    if (row.request_fingerprint !== input.fingerprint) { await conn.commit(); return { outcome: "conflict" }; }
    if (inserted.affectedRows === 1) { await conn.commit(); return { outcome: "acquired", id: Number(row.id) }; }
    if (row.state === "completed" && row.response_json) {
      const response = typeof row.response_json === "string" ? JSON.parse(row.response_json) : row.response_json;
      await conn.commit(); return { outcome: "replay", id: Number(row.id), response };
    }
    if (row.state === "failed" || Number(row.stale)===1) {
      await conn.query("UPDATE campaign_create_requests SET state='processing',last_error=NULL,updated_at=NOW() WHERE id=?", [row.id]);
      await conn.commit(); return { outcome: "acquired", id: Number(row.id) };
    }
    await conn.commit(); return { outcome: "in_progress" };
  } catch (error) { await conn.rollback().catch(() => undefined); throw error; } finally { conn.release(); }
}

export async function completeCampaignCreate(conn: PoolConnection, input: { reservationId: number; campaignId: number; response: Record<string, unknown> }) {
  await conn.query(
    "UPDATE campaign_create_requests SET campaign_id=?,response_json=?,state='completed',completed_at=NOW(),updated_at=NOW() WHERE id=? AND state='processing'",
    [input.campaignId, JSON.stringify(input.response), input.reservationId]
  );
}
export async function failCampaignCreate(reservationId: number, error: unknown) {
  const code = String((error as { code?: unknown })?.code || "CAMPAIGN_CREATE_FAILED").slice(0, 64);
  await pool.query("UPDATE campaign_create_requests SET state='failed',last_error=?,updated_at=NOW() WHERE id=? AND state='processing'", [code, reservationId]);
}
