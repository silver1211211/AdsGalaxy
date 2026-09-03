import "server-only";

import crypto from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { RewardEventRow } from "@/lib/miniappRewardEvents";
import {
  resolvePublicCallbackAddresses,
  validateDirectCallbackUrl as parseDirectCallbackUrl,
} from "@/lib/directCallbackTransport.mjs";

export function directMiniappRewardCallbacksEnabled() {
  return process.env.MINIAPP_DIRECT_REWARD_CALLBACKS_ENABLED === "true";
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
