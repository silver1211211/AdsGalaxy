import "server-only";

import crypto from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import type { RewardEventRow } from "@/lib/miniappRewardEvents";
import {
  dispatchPinnedHttpsCallback,
  resolvePublicCallbackAddresses,
  validateDirectCallbackUrl as parseDirectCallbackUrl,
} from "@/lib/directCallbackTransport.mjs";

export function directMiniappRewardCallbacksEnabled() {
  const value = String(process.env.MINIAPP_DIRECT_REWARD_CALLBACKS_ENABLED || "").trim().toLowerCase();
  return value !== "false" && value !== "0" && value !== "off";
}

export function generateDirectCallbackSecret() {
  return `whsec_${crypto.randomBytes(32).toString("base64url")}`;
}

export function validateDirectCallbackUrl(value: unknown) {
  return parseDirectCallbackUrl(value).toString();
}

export async function assertSafeDirectCallbackUrl(value: unknown) {
  const url = parseDirectCallbackUrl(value);
  await resolvePublicCallbackAddresses(url);
  return url.toString();
}

export async function enqueueDirectMiniappRewardCallback(input: {
  db: PoolConnection;
  miniappId: number;
  verifiedTelegramUserId: string;
  event: RewardEventRow;
}) {
  if (!directMiniappRewardCallbacksEnabled()) return { enqueued: false as const, reason: "disabled" as const };
  const [rows] = await input.db.query<(RowDataPacket & {
    id: number; signing_secret: string; secret_version: number;
  })[]>(
    `SELECT id, signing_secret, secret_version FROM miniapp_reward_callbacks
     WHERE miniapp_id = ? AND status = 'active' LIMIT 1 FOR UPDATE`,
    [input.miniappId]
  );
  const callback = rows[0];
  if (!callback) return { enqueued: false as const, reason: "not_configured" as const };
  const completedAt = new Date(input.event.completed_at).toISOString();
  const payload = {
    event_id: input.event.event_id,
    request_id: input.event.request_id,
    mini_app_id: Number(input.event.miniapp_id),
    user_id: String(input.verifiedTelegramUserId),
    status: "completed",
    completed_at: completedAt,
  };
  const logicalKey = `direct:${callback.id}:${input.event.event_id}:reward.eligible`;
  await input.db.query(
    `INSERT IGNORE INTO developer_webhook_deliveries
      (webhook_id, miniapp_reward_callback_id, application_id, miniapp_id,
       event_type, event_id, webhook_version, signature_version, secret_version,
       signing_secret, logical_delivery_key, payload, status, next_attempt_at)
     VALUES (NULL, ?, NULL, ?, 'reward.eligible', ?, 'v2', 'v2', ?, ?, ?, ?, 'pending', NOW())`,
    [callback.id, input.miniappId, input.event.event_id, callback.secret_version,
      callback.signing_secret, logicalKey, JSON.stringify(payload)]
  );
  return { enqueued: true as const };
}


// The outbox row is committed with the verified completion. Deliver it before
// acknowledging that completion; never make a publisher wait for a cron cycle.
export async function deliverDirectMiniappRewardCallbackNow(miniappId: number, eventId: string) {
  if (!directMiniappRewardCallbacksEnabled()) return;
  const claimToken = crypto.randomBytes(24).toString("hex");
  const [claim] = await pool.query<import("mysql2/promise").ResultSetHeader>(
    `UPDATE developer_webhook_deliveries
     SET status = 'failed', error_message = 'Delivery interrupted before endpoint response',
         claim_token = ?, claimed_at = NOW()
     WHERE miniapp_id = ? AND event_id = ? AND miniapp_reward_callback_id IS NOT NULL
       AND status = 'pending' AND claim_token IS NULL`,
    [claimToken, miniappId, eventId]
  );
  if (claim.affectedRows !== 1) return;
  const [rows] = await pool.query<(RowDataPacket & {
    id: number; event_id: string; event_type: string; payload: unknown;
    signing_secret: string; callback_url: string;
  })[]>(
    `SELECT d.id, d.event_id, d.event_type, d.payload, d.signing_secret, c.callback_url
     FROM developer_webhook_deliveries d
     JOIN miniapp_reward_callbacks c ON c.id = d.miniapp_reward_callback_id
     WHERE d.claim_token = ? LIMIT 1`, [claimToken]
  );
  const delivery = rows[0];
  if (!delivery) return;
  let status: number | null = null;
  let responseHash: string | null = null;
  let reason = "Callback endpoint not reachable";
  let attempts = 0;
  try {
    const payload = typeof delivery.payload === "string" ? JSON.parse(delivery.payload) : delivery.payload;
    const body = JSON.stringify(payload);
    for (let attempt = 1; attempt <= 2; attempt++) {
      attempts = attempt;
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = crypto.createHmac("sha256", delivery.signing_secret)
        .update(`${timestamp}.${delivery.event_id}.${body}`).digest("hex");
      let response: Awaited<ReturnType<typeof dispatchPinnedHttpsCallback>>;
      try {
        response = await dispatchPinnedHttpsCallback({
          url: delivery.callback_url, body, timeoutMs: 4_000,
          headers: {
            "Content-Type": "application/json",
            "x-adsgalaxy-event": delivery.event_type,
            "x-adsgalaxy-event-id": delivery.event_id,
            "x-adsgalaxy-timestamp": timestamp,
            "x-adsgalaxy-signature-version": "v2",
            "x-adsgalaxy-signature": signature,
          },
        });
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        reason = code === "UNSAFE_CALLBACK_DESTINATION" ? "Callback endpoint is not a safe public HTTPS address"
          : "Callback endpoint not reachable";
        continue;
      }
      status = response.status;
      responseHash = response.responseHash;
      if (response.ok) {
        await pool.query(
          `UPDATE developer_webhook_deliveries
           SET status = 'delivered', attempts = ?, response_status = ?, response_body = ?,
               error_message = NULL, delivered_at = NOW(), last_attempt_at = NOW(),
               claim_token = NULL, claimed_at = NULL
           WHERE id = ? AND claim_token = ?`,
          [attempts, status, responseHash, delivery.id, claimToken]
        );
        return;
      }
      reason = `Callback endpoint returned HTTP ${status}`;
    }
  } catch {
    reason = "Callback delivery data could not be prepared";
  }
  await pool.query(
    `UPDATE developer_webhook_deliveries
     SET status = 'failed', attempts = ?, response_status = ?, response_body = ?,
         error_message = ?, terminal_at = NOW(), last_attempt_at = NOW(),
         claim_token = NULL, claimed_at = NULL
     WHERE id = ? AND claim_token = ?`,
    [attempts, status, responseHash, reason, delivery.id, claimToken]
  );
}
