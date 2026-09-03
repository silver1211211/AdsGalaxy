import "server-only";

import crypto from "crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { enqueueProductionRewardWebhook } from "@/lib/developerPlatform";

export type RewardEnvironment = "sandbox" | "production";
export type RewardEventStatus =
  | "client_completed"
  | "eligible"
  | "claimed"
  | "rejected"
  | "expired"
  | "reversed";
export type RewardVerificationLevel =
  | "client_confirmed"
  | "ads_galaxy_validated"
  | "provider_verified";

type Queryable = typeof pool | PoolConnection;

type BindingRow = RowDataPacket & {
  id: number;
  application_id: number;
  miniapp_id: number;
  environment: RewardEnvironment;
  status: string;
};

export type RewardEventRow = RowDataPacket & {
  id: number;
  event_id: string;
  request_id: string;
  miniapp_id: number;
  application_id: number | null;
  publisher_id: number;
  telegram_user_id: string | number;
  external_user_reference: string | null;
  provider: string;
  provider_event_id: string | null;
  status: RewardEventStatus;
  verification_level: RewardVerificationLevel;
  reward_eligible: number | boolean;
  completed_at: Date | string;
  expires_at: Date | string;
  claimed_at: Date | string | null;
  claimed_by_key_id: number | null;
  claimed_by_application_id: number | null;
  reversed_at: Date | string | null;
  reversal_reason: string | null;
  environment: RewardEnvironment;
  metadata: string | Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type ClaimRow = RowDataPacket & {
  response_payload: string | Record<string, unknown>;
};

type LockedRewardEventRow = RewardEventRow & {
  claim_expired: number | boolean;
};

type MysqlError = Error & {
  code?: string;
  errno?: number;
};

export class RewardCallbackError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "RewardCallbackError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function iso(value: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function parseStoredJson(value: string | Record<string, unknown>) {
  if (typeof value !== "string") return value;
  return JSON.parse(value) as Record<string, unknown>;
}

function randomPublicId(prefix: "rwe" | "rwc") {
  return `${prefix}_${crypto.randomBytes(24).toString("base64url")}`;
}

function isDuplicateEntry(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const mysqlError = error as MysqlError;
  return mysqlError.code === "ER_DUP_ENTRY" || mysqlError.errno === 1062;
}

async function loadClaimByIdempotencyForUpdate(
  conn: PoolConnection,
  applicationId: number,
  idempotencyKey: string
) {
  const [rows] = await conn.query<ClaimRow[]>(
    `SELECT response_payload
     FROM miniapp_reward_claims
     WHERE application_id = ?
       AND idempotency_key = ?
     LIMIT 1
     FOR UPDATE`,
    [applicationId, idempotencyKey]
  );
  return rows[0] || null;
}

async function loadClaimByRewardEventForUpdate(
  conn: PoolConnection,
  rewardEventId: number
) {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id
     FROM miniapp_reward_claims
     WHERE reward_event_id = ?
     LIMIT 1
     FOR UPDATE`,
    [rewardEventId]
  );
  return rows[0] || null;
}

export function productionRewardCallbacksEnabled() {
  const value = clean(process.env.PRODUCTION_REWARD_CALLBACKS_ENABLED).toLowerCase();
  return value === "true" || value === "1" || value === "on";
}

export function generateRewardEventId() {
  return randomPublicId("rwe");
}

export function generatePublicClaimId() {
  return randomPublicId("rwc");
}

function assertEnvironment(value: unknown): asserts value is RewardEnvironment {
  if (value !== "sandbox" && value !== "production") {
    throw new RewardCallbackError(400, "INVALID_ENVIRONMENT", "Invalid reward environment");
  }
}

export async function createOrReactivateApplicationMiniappBinding(input: {
  applicationId: number;
  miniappId: number;
  environment: RewardEnvironment;
}) {
  assertEnvironment(input.environment);
  const applicationId = positiveInteger(input.applicationId);
  const miniappId = positiveInteger(input.miniappId);
  if (!applicationId || !miniappId) {
    throw new RewardCallbackError(400, "INVALID_BINDING", "Valid application and Mini App IDs are required");
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [ownerRows] = await conn.query<Array<RowDataPacket & {
      application_user_id: number;
      application_mode: string;
      application_status: string;
      miniapp_user_id: number;
      miniapp_deleted: number | boolean;
    }>>(
      `SELECT
         a.user_id AS application_user_id,
         a.mode AS application_mode,
         a.status AS application_status,
         m.user_id AS miniapp_user_id,
         m.is_deleted AS miniapp_deleted
       FROM developer_applications a
       JOIN miniapps m ON m.id = ?
       WHERE a.id = ?
       FOR UPDATE`,
      [miniappId, applicationId]
    );
    const ownership = ownerRows[0];
    if (!ownership || ownership.application_status !== "active" || Boolean(ownership.miniapp_deleted)) {
      throw new RewardCallbackError(404, "BINDING_TARGET_UNAVAILABLE", "Application or Mini App is unavailable");
    }
    if (Number(ownership.application_user_id) !== Number(ownership.miniapp_user_id)) {
      throw new RewardCallbackError(403, "CROSS_PUBLISHER_BINDING", "Application and Mini App owners do not match");
    }
    if (ownership.application_mode !== input.environment) {
      throw new RewardCallbackError(403, "BINDING_ENVIRONMENT_MISMATCH", "Application environment does not match binding");
    }

    const [existingRows] = await conn.query<BindingRow[]>(
      `SELECT id, application_id, miniapp_id, environment, status
       FROM developer_application_miniapps
       WHERE miniapp_id = ? AND environment = ?
       FOR UPDATE`,
      [miniappId, input.environment]
    );
    const existing = existingRows[0];
    if (existing && Number(existing.application_id) !== applicationId) {
      throw new RewardCallbackError(409, "MINIAPP_ENVIRONMENT_ALREADY_BOUND", "Mini App environment is already bound");
    }

    if (existing) {
      await conn.query(
        "UPDATE developer_application_miniapps SET status = 'active' WHERE id = ?",
        [existing.id]
      );
    } else {
      await conn.query(
        `INSERT INTO developer_application_miniapps
          (application_id, miniapp_id, environment, status)
         VALUES (?, ?, ?, 'active')`,
        [applicationId, miniappId, input.environment]
      );
    }
    await conn.commit();
    return getActiveApplicationMiniappBinding(applicationId, miniappId, input.environment);
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    conn.release();
  }
}

export async function getActiveApplicationMiniappBinding(
  applicationId: number,
  miniappId: number,
  environment: RewardEnvironment,
  db: Queryable = pool
) {
  const [rows] = await db.query<BindingRow[]>(
    `SELECT id, application_id, miniapp_id, environment, status
     FROM developer_application_miniapps
     WHERE application_id = ?
       AND miniapp_id = ?
       AND environment = ?
       AND status = 'active'
     LIMIT 1`,
    [applicationId, miniappId, environment]
  );
  return rows[0] || null;
}

export async function getActiveProductionBindingForMiniapp(
  conn: PoolConnection,
  miniappId: number
) {
  const [rows] = await conn.query<Array<BindingRow & { publisher_id: number }>>(
    `SELECT dam.id, dam.application_id, dam.miniapp_id, dam.environment, dam.status,
            a.user_id AS publisher_id
     FROM developer_application_miniapps dam
     JOIN developer_applications a
       ON a.id = dam.application_id
      AND a.user_id = (SELECT m.user_id FROM miniapps m WHERE m.id = dam.miniapp_id)
      AND a.status = 'active'
      AND a.mode = 'production'
     WHERE dam.miniapp_id = ?
       AND dam.environment = 'production'
       AND dam.status = 'active'
     LIMIT 1
     FOR UPDATE`,
    [miniappId]
  );
  return rows[0] || null;
}

export async function requireApplicationMiniappScope(input: {
  applicationId: number;
  miniappId: number;
  environment: RewardEnvironment;
  userId: number;
  db?: Queryable;
}) {
  assertEnvironment(input.environment);
  const db = input.db || pool;
  const [rows] = await db.query<BindingRow[]>(
    `SELECT dam.id, dam.application_id, dam.miniapp_id, dam.environment, dam.status
     FROM developer_application_miniapps dam
     JOIN developer_applications a
       ON a.id = dam.application_id
      AND a.user_id = ?
      AND a.status = 'active'
      AND a.mode = dam.environment
     JOIN miniapps m
       ON m.id = dam.miniapp_id
      AND m.user_id = a.user_id
      AND m.is_deleted = FALSE
     WHERE dam.application_id = ?
       AND dam.miniapp_id = ?
       AND dam.environment = ?
       AND dam.status = 'active'
     LIMIT 1`,
    [input.userId, input.applicationId, input.miniappId, input.environment]
  );
  if (!rows[0]) {
    throw new RewardCallbackError(403, "REWARD_SCOPE_MISMATCH", "Reward scope is unavailable");
  }
  return rows[0];
}

export async function getRewardEventByRequestId(requestId: string, db: Queryable = pool) {
  const [rows] = await db.query<RewardEventRow[]>(
    "SELECT * FROM miniapp_reward_events WHERE request_id = ? LIMIT 1",
    [clean(requestId)]
  );
  return rows[0] || null;
}

export async function getRewardEventByEventId(eventId: string, db: Queryable = pool) {
  const [rows] = await db.query<RewardEventRow[]>(
    "SELECT * FROM miniapp_reward_events WHERE event_id = ? LIMIT 1",
    [clean(eventId)]
  );
  return rows[0] || null;
}

export function normalizeRewardEvent(event: RewardEventRow) {
  const effectivelyExpired = event.status === "expired"
    || (!event.claimed_at && !event.reversed_at && new Date(event.expires_at).getTime() <= Date.now());
  return {
    event_id: event.event_id,
    request_id: event.request_id,
    mini_app_id: Number(event.miniapp_id),
    provider: event.provider,
    status: effectivelyExpired ? "expired" : event.status,
    verification_level: event.verification_level,
    reward_eligible: effectivelyExpired ? false : Boolean(event.reward_eligible),
    completed_at: iso(event.completed_at),
    expires_at: iso(event.expires_at),
    claimed: Boolean(event.claimed_at) || event.status === "claimed",
    reversed: Boolean(event.reversed_at) || event.status === "reversed",
  };
}

function assertEventScope(event: RewardEventRow, input: {
  applicationId: number;
  miniappId: number;
  environment: RewardEnvironment;
}) {
  if (
    Number(event.application_id) !== input.applicationId
    || Number(event.miniapp_id) !== input.miniappId
    || event.environment !== input.environment
  ) {
    throw new RewardCallbackError(404, "REWARD_EVENT_NOT_FOUND", "Reward event is unavailable");
  }
}

export async function bindExternalUserReference(input: {
  eventId: string;
  applicationId: number;
  miniappId: number;
  environment: RewardEnvironment;
  externalUserReference: string;
}) {
  const externalUserReference = clean(input.externalUserReference);
  if (!externalUserReference || externalUserReference.length > 160) {
    throw new RewardCallbackError(400, "INVALID_EXTERNAL_USER_REFERENCE", "Invalid external user reference");
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RewardEventRow[]>(
      "SELECT * FROM miniapp_reward_events WHERE event_id = ? FOR UPDATE",
      [input.eventId]
    );
    const event = rows[0];
    if (!event) throw new RewardCallbackError(404, "REWARD_EVENT_NOT_FOUND", "Reward event is unavailable");
    assertEventScope(event, input);
    if (event.external_user_reference && event.external_user_reference !== externalUserReference) {
      throw new RewardCallbackError(403, "REWARD_USER_MISMATCH", "Reward user does not match");
    }
    if (!event.external_user_reference) {
      await conn.query(
        `UPDATE miniapp_reward_events
         SET external_user_reference = ?
         WHERE id = ? AND external_user_reference IS NULL`,
        [externalUserReference, event.id]
      );
      event.external_user_reference = externalUserReference;
    }
    await conn.commit();
    return event;
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    conn.release();
  }
}

export async function recordRewardEventTransition(input: {
  db: Queryable;
  rewardEventId: number;
  fromStatus: RewardEventStatus | null;
  toStatus: RewardEventStatus;
  fromVerificationLevel: RewardVerificationLevel | null;
  toVerificationLevel: RewardVerificationLevel;
  reasonCode: string;
  actorType: string;
  actorId?: number | null;
  metadata?: Record<string, unknown>;
}) {
  await input.db.query(
    `INSERT INTO miniapp_reward_event_transitions
      (reward_event_id, from_status, to_status, from_verification_level,
       to_verification_level, reason_code, actor_type, actor_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.rewardEventId,
      input.fromStatus,
      input.toStatus,
      input.fromVerificationLevel,
      input.toVerificationLevel,
      clean(input.reasonCode).slice(0, 80),
      clean(input.actorType).slice(0, 40),
      input.actorId || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ]
  );
}

export async function createRewardEvent(input: {
  db: PoolConnection;
  requestId: string;
  miniappId: number;
  applicationId: number | null;
  publisherId: number;
  telegramUserId: string | number;
  provider: string;
  providerEventId?: string | null;
  status: "client_completed" | "eligible";
  verificationLevel: "client_confirmed" | "ads_galaxy_validated" | "provider_verified";
  rewardEligible: boolean;
  environment: RewardEnvironment;
  completedAt?: Date;
  metadata?: Record<string, unknown>;
}) {
  const matchesRequestScope = (event: RewardEventRow) => (
    Number(event.miniapp_id) === Number(input.miniappId)
    && (event.application_id === null ? input.applicationId === null : Number(event.application_id) === Number(input.applicationId))
    && Number(event.publisher_id) === Number(input.publisherId)
    && String(event.telegram_user_id) === String(input.telegramUserId)
    && event.provider === clean(input.provider)
    && event.environment === input.environment
  );
  const returnExistingRequest = (event: RewardEventRow) => {
    if (!matchesRequestScope(event)) {
      throw new RewardCallbackError(409, "REWARD_REQUEST_SCOPE_CONFLICT", "Reward request belongs to a different scope");
    }
    return event;
  };
  const existing = await getRewardEventByRequestId(input.requestId, input.db);
  if (existing) return returnExistingRequest(existing);

  let eventId = "";
  let inserted = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    eventId = generateRewardEventId();
    try {
      await input.db.query<ResultSetHeader>(
        `INSERT INTO miniapp_reward_events
          (event_id, request_id, miniapp_id, application_id, publisher_id,
           telegram_user_id, provider, provider_event_id, status, verification_level,
           reward_eligible, completed_at, expires_at, environment, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 24 HOUR), ?, ?)`,
        [
          eventId,
          clean(input.requestId),
          input.miniappId,
          input.applicationId,
          input.publisherId,
          input.telegramUserId,
          clean(input.provider),
          clean(input.providerEventId) || null,
          input.status,
          input.verificationLevel,
          input.rewardEligible ? 1 : 0,
          input.environment,
          input.metadata ? JSON.stringify(input.metadata) : null,
        ]
      );
      inserted = true;
      break;
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;
      const [requestRows] = await input.db.query<RewardEventRow[]>(
        "SELECT * FROM miniapp_reward_events WHERE request_id = ? FOR UPDATE",
        [clean(input.requestId)]
      );
      if (requestRows[0]) return returnExistingRequest(requestRows[0]);
    }
  }
  if (!inserted) {
    throw new RewardCallbackError(500, "REWARD_EVENT_ID_GENERATION_FAILED", "Reward event creation failed");
  }
  const event = await getRewardEventByEventId(eventId, input.db);
  if (!event) throw new RewardCallbackError(500, "REWARD_EVENT_CREATION_FAILED", "Reward event creation failed");
  await recordRewardEventTransition({
    db: input.db,
    rewardEventId: event.id,
    fromStatus: null,
    toStatus: input.status,
    fromVerificationLevel: null,
    toVerificationLevel: input.verificationLevel,
    reasonCode: "completion_accepted",
    actorType: "system",
    metadata: input.metadata,
  });
  return event;
}

export async function isScopedMediationRequestPending(input: {
  requestId: string;
  miniappId: number;
  publisherId: number;
  db?: Queryable;
}) {
  const db = input.db || pool;
  // A pending response is only safe when the request is tied to the requested
  // Mini App and that Mini App is owned by the authenticated application user.
  // The short window avoids turning this endpoint into a historical request-ID oracle.
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT mr.id
     FROM miniapp_mediation_requests mr
     JOIN miniapps m
       ON m.id = mr.miniapp_id
      AND m.user_id = ?
      AND m.is_deleted = FALSE
     WHERE mr.request_id = ?
       AND mr.miniapp_id = ?
       AND mr.created_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)
     LIMIT 1`,
    [input.publisherId, clean(input.requestId), input.miniappId]
  );
  return Boolean(rows[0]);
}

export async function claimRewardEvent(input: {
  eventId: string;
  miniappId: number;
  applicationId: number;
  apiKeyId: number;
  userId: number;
  environment: RewardEnvironment;
  externalUserReference: string;
  idempotencyKey: string;
}) {
  const eventId = clean(input.eventId);
  const idempotencyKey = clean(input.idempotencyKey);
  const externalUserReference = clean(input.externalUserReference);
  if (!eventId || !idempotencyKey || idempotencyKey.length > 160 || !externalUserReference || externalUserReference.length > 160) {
    throw new RewardCallbackError(400, "INVALID_CLAIM_REQUEST", "Invalid reward claim request");
  }

  const conn = await pool.getConnection();
  let committed = false;
  try {
    await conn.beginTransaction();
    const [idempotentRows] = await conn.query<ClaimRow[]>(
      `SELECT response_payload
       FROM miniapp_reward_claims
       WHERE application_id = ? AND idempotency_key = ?
       LIMIT 1`,
      [input.applicationId, idempotencyKey]
    );
    if (idempotentRows[0]) {
      await conn.commit();
      committed = true;
      return parseStoredJson(idempotentRows[0].response_payload);
    }

    await requireApplicationMiniappScope({ ...input, db: conn });
    const [eventRows] = await conn.query<LockedRewardEventRow[]>(
      "SELECT *, (expires_at <= NOW()) AS claim_expired FROM miniapp_reward_events WHERE event_id = ? FOR UPDATE",
      [eventId]
    );
    const event = eventRows[0];
    if (!event) throw new RewardCallbackError(404, "REWARD_EVENT_NOT_FOUND", "Reward event is unavailable");
    assertEventScope(event, input);

    const idempotentWinner = await loadClaimByIdempotencyForUpdate(
      conn,
      input.applicationId,
      idempotencyKey
    );
    if (idempotentWinner) {
      await conn.commit();
      committed = true;
      return parseStoredJson(idempotentWinner.response_payload);
    }

    if (event.external_user_reference && event.external_user_reference !== externalUserReference) {
      throw new RewardCallbackError(403, "REWARD_USER_MISMATCH", "Reward user does not match");
    }
    if (event.status === "reversed" || event.reversed_at) {
      throw new RewardCallbackError(409, "REWARD_REVERSED", "Reward event has been reversed");
    }
    if (event.status === "claimed" || event.claimed_at) {
      throw new RewardCallbackError(409, "REWARD_ALREADY_CLAIMED", "Reward event has already been claimed");
    }
    if (event.status === "expired" || Boolean(event.claim_expired)) {
      if (event.status !== "expired") {
        const [expiryResult] = await conn.query<ResultSetHeader>(
          `UPDATE miniapp_reward_events
           SET status = 'expired', reward_eligible = 0
           WHERE id = ?
             AND status NOT IN ('claimed', 'reversed', 'expired')
             AND claimed_at IS NULL
             AND reversed_at IS NULL
             AND expires_at <= NOW()`,
          [event.id]
        );
        if (expiryResult.affectedRows === 1) {
          await recordRewardEventTransition({
            db: conn,
            rewardEventId: event.id,
            fromStatus: event.status,
            toStatus: "expired",
            fromVerificationLevel: event.verification_level,
            toVerificationLevel: event.verification_level,
            reasonCode: "claim_window_expired",
            actorType: "api",
            actorId: input.apiKeyId,
          });
        }
      }
      await conn.commit();
      committed = true;
      throw new RewardCallbackError(410, "REWARD_EXPIRED", "Reward event has expired");
    }
    if (event.status !== "eligible" || !Boolean(event.reward_eligible)) {
      throw new RewardCallbackError(409, "REWARD_NOT_ELIGIBLE", "Reward event is not eligible");
    }

    if (!event.external_user_reference) {
      await conn.query(
        "UPDATE miniapp_reward_events SET external_user_reference = ? WHERE id = ? AND external_user_reference IS NULL",
        [externalUserReference, event.id]
      );
    }

    const claimedAt = new Date();
    let response: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const claimId = generatePublicClaimId();
      const candidateResponse = {
        success: true,
        api_version: "v1",
        claim: {
          claim_id: claimId,
          event_id: event.event_id,
          status: "claimed",
          external_user_reference: externalUserReference,
          claimed_at: claimedAt.toISOString(),
        },
      };
      try {
        await conn.query(
          `INSERT INTO miniapp_reward_claims
            (reward_event_id, public_claim_id, application_id, api_key_id,
             idempotency_key, external_user_reference, status, response_payload)
           VALUES (?, ?, ?, ?, ?, ?, 'claimed', ?)`,
          [
            event.id,
            claimId,
            input.applicationId,
            input.apiKeyId,
            idempotencyKey,
            externalUserReference,
            JSON.stringify(candidateResponse),
          ]
        );
        response = candidateResponse;
        break;
      } catch (error) {
        if (!isDuplicateEntry(error)) throw error;
        const idempotencyWinner = await loadClaimByIdempotencyForUpdate(
          conn,
          input.applicationId,
          idempotencyKey
        );
        if (idempotencyWinner) {
          await conn.rollback();
          committed = true;
          return parseStoredJson(idempotencyWinner.response_payload);
        }
        const eventWinner = await loadClaimByRewardEventForUpdate(conn, event.id);
        if (eventWinner) {
          throw new RewardCallbackError(409, "REWARD_ALREADY_CLAIMED", "Reward event has already been claimed");
        }
      }
    }
    if (!response) {
      throw new RewardCallbackError(500, "CLAIM_ID_GENERATION_FAILED", "Reward claim creation failed");
    }
    const [updateResult] = await conn.query<ResultSetHeader>(
      `UPDATE miniapp_reward_events
       SET status = 'claimed',
           claimed_at = ?,
           claimed_by_key_id = ?,
           claimed_by_application_id = ?
       WHERE id = ?
         AND status = 'eligible'
         AND reward_eligible = 1
         AND claimed_at IS NULL
         AND reversed_at IS NULL
         AND expires_at > NOW()`,
      [claimedAt, input.apiKeyId, input.applicationId, event.id]
    );
    if (updateResult.affectedRows !== 1) {
      throw new RewardCallbackError(409, "REWARD_ALREADY_CLAIMED", "Reward event is no longer claimable");
    }
    await recordRewardEventTransition({
      db: conn,
      rewardEventId: event.id,
      fromStatus: event.status,
      toStatus: "claimed",
      fromVerificationLevel: event.verification_level,
      toVerificationLevel: event.verification_level,
      reasonCode: "publisher_claimed",
      actorType: "api_key",
      actorId: input.apiKeyId,
    });
    await enqueueProductionRewardWebhook({
      db: conn,
      applicationId: input.applicationId,
      eventType: "reward.claimed",
      event: {
        ...event,
        status: "claimed",
        reward_eligible: false,
        external_user_reference: externalUserReference,
      },
      claim: response.claim as {
        claim_id: string;
        claimed_at: string;
      },
    });
    await conn.commit();
    committed = true;
    return response;
  } catch (error) {
    if (!committed) await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    conn.release();
  }
}
