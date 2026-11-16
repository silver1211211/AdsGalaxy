import type { PoolConnection } from "mysql2/promise";
import * as viewPipeline from "@/lib/channelViewPipeline";

export type NormalizedViewTimestamp = {
  epochMs: number;
  utcDate: Date;
  utcIso: string;
  utcSqlDatetime: string;
};

const VALID_VIEW_FETCH_SOURCES = new Set([
  "public_html",
  "public_api",
  "mtproto",
  "mtproto_private",
  "mtproto_public_fallback",
  "admin_public_html",
  "admin_public_api",
  "admin_mtproto_private",
  "admin_mtproto_public_fallback",
  "pre_deletion_public_html",
  "pre_deletion_public_api",
  "pre_deletion_mtproto_private",
  "pre_deletion_mtproto_public_fallback",
]);

const VALID_VIEW_TRACKING_STATUSES = new Set(["active", "available"]);

export function isEligibleChannelViewFetchSource(source: string | null | undefined): boolean {
  return Boolean(source && VALID_VIEW_FETCH_SOURCES.has(String(source)));
}

export function isEligibleChannelViewTrackingStatus(status: string | null | undefined): boolean {
  return Boolean(status && VALID_VIEW_TRACKING_STATUSES.has(String(status)));
}

function parseFourteenDigitUtc(digits: string): number {
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const hour = Number(digits.slice(8, 10));
  const minute = Number(digits.slice(10, 12));
  const second = Number(digits.slice(12, 14));
  if (
    year < 1970 || year > 2999 ||
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour < 0 || hour > 23 ||
    minute < 0 || minute > 59 ||
    second < 0 || second > 59
  ) {
    return Number.NaN;
  }
  return Date.UTC(year, month - 1, day, hour, minute, second, 0);
}

/**
 * Normalize any view timestamp (Date, 13-digit epoch ms, 10-digit epoch s,
 * legacy 14-digit YYYYMMDDHHMMSS integer, or ISO/SQL string) into UTC epoch ms and Date.
 */
export function normalizeViewTimestamp(observedAt: Date | string | number = Date.now()): NormalizedViewTimestamp {
  let epochMs = Number.NaN;

  if (observedAt instanceof Date || (observedAt && typeof (observedAt as unknown as Date).getTime === "function")) {
    epochMs = (observedAt as unknown as Date).getTime();
  } else if (typeof observedAt === "number") {
    if (!Number.isFinite(observedAt) || observedAt <= 0) {
      throw new Error("invalid_view_timestamp");
    }
    const floored = Math.floor(observedAt);
    const digits = String(floored);
    if (digits.length === 14 && floored >= 19700101000000 && floored <= 29991231235959) {
      epochMs = parseFourteenDigitUtc(digits);
    } else if (floored >= 100_000_000 && floored < 10_000_000_000) {
      epochMs = floored * 1000;
    } else if (floored >= 100_000_000_000 && floored < 10_000_000_000_000) {
      epochMs = floored;
    } else {
      throw new Error("invalid_view_timestamp");
    }
  } else if (typeof observedAt === "string") {
    const trimmed = observedAt.trim();
    if (!trimmed) throw new Error("invalid_view_timestamp");
    if (/^\d+$/.test(trimmed)) {
      return normalizeViewTimestamp(Number(trimmed));
    }
    const parsed = new Date(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(trimmed)
        ? trimmed.replace(" ", "T") + "Z"
        : trimmed
    ).getTime();
    epochMs = parsed;
  } else {
    throw new Error("invalid_view_timestamp");
  }

  if (!Number.isFinite(epochMs) || epochMs <= 0) {
    throw new Error("invalid_view_timestamp");
  }

  const utcDate = new Date(epochMs);
  const utcIso = utcDate.toISOString();
  const utcSqlDatetime = utcIso.replace("T", " ").replace("Z", "");
  return { epochMs: Math.floor(epochMs), utcDate, utcIso, utcSqlDatetime };
}

/**
 * Universal MariaDB SQL expression that normalizes campaign_posts.last_views_update
 * regardless of whether the underlying column is BIGINT (13-digit epoch ms, 10-digit epoch s,
 * or 14-digit YYYYMMDDHHMMSS from legacy NOW()) or DATETIME.
 *
 * The result is a DATETIME(6) on a pure UTC basis: epoch values are added to the literal
 * 1970-01-01 00:00:00 epoch (never FROM_UNIXTIME, which depends on the session time zone),
 * so comparisons are identical under any @@session.time_zone. Zero, empty, '0000-00-00'
 * and NULL values normalize to NULL. The column is only ever compared through
 * CAST(... AS CHAR), avoiding DATETIME-vs-integer coercion errors under strict SQL mode.
 */
export function normalizedLastViewsUpdateDatetimeSql(columnExpr = "cp.last_views_update"): string {
  const asChar = `CAST(${columnExpr} AS CHAR)`;
  return `(CASE
    WHEN ${columnExpr} IS NULL
      OR NULLIF(TRIM(${asChar}), '') IS NULL
      OR ${asChar} = '0'
      OR ${asChar} LIKE '0000-00-00%'
      THEN NULL
    WHEN ${asChar} REGEXP '^[0-9]{14}$'
      THEN CAST(STR_TO_DATE(${asChar}, '%Y%m%d%H%i%s') AS DATETIME(6))
    WHEN ${asChar} REGEXP '^[0-9]{11,13}$'
      THEN DATE_ADD(CAST('1970-01-01 00:00:00.000000' AS DATETIME(6)), INTERVAL (CAST(${asChar} AS UNSIGNED) * 1000) MICROSECOND)
    WHEN ${asChar} REGEXP '^[0-9]{9,10}$'
      THEN DATE_ADD(CAST('1970-01-01 00:00:00.000000' AS DATETIME(6)), INTERVAL CAST(${asChar} AS UNSIGNED) SECOND)
    ELSE CAST(${columnExpr} AS DATETIME(6))
  END)`;
}

const columnModeCache = new Map<object, "bigint" | "datetime">();

function isColumnTypeTruncationError(error: unknown): boolean {
  const err = error as { code?: string; errno?: number; message?: string } | null;
  if (!err) return false;
  if (err.code === "ER_WARN_DATA_TRUNCATED" || err.code === "ER_TRUNCATED_WRONG_VALUE") return true;
  if (err.errno === 1265 || err.errno === 1292) return true;
  return /Data truncated for column 'last_views_update'|Incorrect datetime value.*last_views_update|Incorrect integer value.*last_views_update/i.test(
    String(err.message || "")
  );
}

function selectInitialMode(db: object, observedAt: Date | string | number): "bigint" | "datetime" {
  const cached = columnModeCache.get(db);
  if (cached) return cached;
  if (observedAt instanceof Date || (observedAt && typeof (observedAt as unknown as Date).getTime === "function")) return "datetime";
  return "bigint";
}

function classifyFailureFallback(reason: string, retryAfterSeconds?: number | null) {
  const normalized = String(reason || "unknown_error").toLowerCase();
  const floodMatch = normalized.match(/flood_wait_?(\d+)|retry_after[=:](\d+)/i);
  const extractedRetry = retryAfterSeconds ?? (floodMatch ? Number(floodMatch[1] || floodMatch[2]) : null);
  if (/message_id_invalid|confirmed_message_not_found|invalid_message_id|message_deleted|post_deleted/.test(normalized)) {
    return { classification: "terminal" as const, retryAfterSeconds: null, terminal: true };
  }
  if (/uncertain_view_response/.test(normalized)) {
    return { classification: "temporary" as const, retryAfterSeconds: 300, terminal: false };
  }
  if (/no_verified_private_member|channel_private|not_channel_member|channel_invalid|expired_invite|identity_mismatch|channel_not_found|membership_required|private_channel_membership_not_confirmed/.test(normalized)) {
    return { classification: "operational" as const, retryAfterSeconds: 21_600, terminal: false };
  }
  if (/rate_limited|flood/.test(normalized)) {
    return {
      classification: "temporary" as const,
      retryAfterSeconds: Math.max(1, Math.min(86_400, Math.floor(Number(extractedRetry || 300)))),
      terminal: false,
    };
  }
  if (typeof viewPipeline.classifyViewFailure === "function") {
    return viewPipeline.classifyViewFailure(reason, extractedRetry);
  }
  return { classification: "temporary" as const, retryAfterSeconds: 300, terminal: false };
}

function encodeFailureFallback(reason: string, retryAfterSeconds?: number | null) {
  const policy = classifyFailureFallback(reason, retryAfterSeconds);
  const suffix = policy.retryAfterSeconds ? `|retry_after=${policy.retryAfterSeconds}` : "";
  return `${policy.classification}:${String(reason || "unknown_error").replace(/\s+/g, "_").slice(0, 420)}${suffix}`.slice(0, 500);
}

type QueryResult = unknown;

function affectedRowsOf(out: QueryResult): number | null {
  const header = (Array.isArray(out) ? out[0] : out) as { affectedRows?: number } | undefined;
  if (!header || typeof header.affectedRows !== "number") return null;
  return header.affectedRows;
}

function isMissingColumnError(error: unknown): boolean {
  const err = error as { code?: string; errno?: number } | null;
  return err?.code === "ER_BAD_FIELD_ERROR" || err?.errno === 1054;
}

/**
 * Optional Batch 4 diagnostic columns (db/migrations/20261106_0400_*). Only these may be
 * omitted when an unmigrated schema reports ER_BAD_FIELD_ERROR. Every other column
 * (status, deleted_at, views, last_views_update, view_fetch_status, view_fetch_error,
 * view_fetch_source) is required: if one is missing the update fails closed (rethrows).
 */
const OPTIONAL_VIEW_COLUMNS = [
  "last_views_update_at",
  "view_fetch_failures",
  "last_view_failure_class",
  "view_next_retry_at",
  "last_view_attempt_at",
] as const;
type OptionalViewColumn = (typeof OPTIONAL_VIEW_COLUMNS)[number];

const missingOptionalColumnCache = new WeakMap<object, Set<OptionalViewColumn>>();

function unknownOptionalColumn(error: unknown): OptionalViewColumn | null {
  if (!isMissingColumnError(error)) return null;
  const message = String((error as { message?: string })?.message || "");
  const match = message.match(/Unknown column '(?:[^'.]+\.)?([^'.]+)'/i);
  if (!match) return null;
  const column = match[1].toLowerCase();
  return (OPTIONAL_VIEW_COLUMNS as readonly string[]).includes(column) ? (column as OptionalViewColumn) : null;
}

/** Placement states that may still receive a confirmed observation (incl. pre-deletion capture). */
const LIVE_PLACEMENT_GUARD = "status IN ('active','cleanup_pending','delete_failed') AND deleted_at IS NULL";

/**
 * Run a guarded UPDATE, omitting only optional Batch 4 columns that the schema reports as
 * missing. The builder is re-invoked with the reduced column set; the status, deleted_at and
 * normalized last_views_update guards are always present in the WHERE clause.
 */
async function runWithOptionalColumns(
  db: Pick<PoolConnection, "query">,
  build: (has: (column: OptionalViewColumn) => boolean) => { sql: string; params: unknown[] },
): Promise<QueryResult> {
  const known = missingOptionalColumnCache.get(db as object);
  const missing = new Set<OptionalViewColumn>(known ? Array.from(known) : []);
  for (let attempt = 0; attempt <= OPTIONAL_VIEW_COLUMNS.length; attempt++) {
    const { sql, params } = build((column) => !missing.has(column));
    try {
      const out = await db.query(sql, params);
      if (missing.size > 0) missingOptionalColumnCache.set(db as object, missing);
      return out;
    } catch (error) {
      const column = unknownOptionalColumn(error);
      // Fail closed: unknown core columns, or anything that is not a missing optional column.
      if (!column || missing.has(column)) throw error;
      missing.add(column);
    }
  }
  throw new Error("channel_view_schema_incomplete");
}

/**
 * Persist a successful observation in ONE atomic UPDATE whose WHERE clause controls the whole
 * row: every confirmed-view field (views, last_views_update, last_views_update_at, status,
 * error, source, failure counters and retry cooldown) is written together or not at all.
 *
 * An observation that is older than or equal to the stored confirmed observation (compared on
 * a UTC basis for BIGINT epoch-ms / epoch-s / legacy 14-digit and DATETIME representations),
 * older than or equal to a recorded attempt, or that targets a deleted/non-live placement
 * changes zero columns and reports `updated: false, skippedStale: true`.
 */
export async function persistSuccessfulChannelViews(
  db: Pick<PoolConnection, "query">,
  postId: number,
  views: number,
  source: string,
  observedAt: Date | string | number = Date.now(),
) {
  if (!Number.isFinite(views) || views < 0) throw new Error("invalid_view_observation");
  if (!isEligibleChannelViewFetchSource(source)) throw new Error("invalid_view_fetch_source");
  const normalized = normalizeViewTimestamp(observedAt);
  const safeViews = Math.floor(views);
  const normalizedStored = normalizedLastViewsUpdateDatetimeSql("last_views_update");
  let mode = selectInitialMode(db as object, observedAt);

  const runAtomicUpdate = (targetMode: "bigint" | "datetime") => {
    // DATETIME columns receive the explicit UTC SQL literal (never a driver-local Date).
    const storedTs = targetMode === "bigint" ? normalized.epochMs : normalized.utcSqlDatetime;
    return runWithOptionalColumns(db, (has) => {
      const set: string[] = ["views=GREATEST(COALESCE(views,0),?)", "last_views_update=?"];
      const setParams: unknown[] = [safeViews, storedTs];
      if (has("last_views_update_at")) { set.push("last_views_update_at=?"); setParams.push(normalized.utcSqlDatetime); }
      set.push("view_fetch_status='success'", "view_fetch_error=NULL", "view_fetch_source=?");
      setParams.push(source);
      if (has("view_fetch_failures")) set.push("view_fetch_failures=0");
      if (has("last_view_failure_class")) set.push("last_view_failure_class=NULL");
      if (has("view_next_retry_at")) set.push("view_next_retry_at=NULL");

      const where: string[] = ["id=?", LIVE_PLACEMENT_GUARD];
      const whereParams: unknown[] = [postId];
      if (has("last_views_update_at")) {
        where.push("(last_views_update_at IS NULL OR last_views_update_at<?)");
        whereParams.push(normalized.utcSqlDatetime);
      }
      where.push(`(${normalizedStored} IS NULL OR ${normalizedStored}<?)`);
      whereParams.push(normalized.utcSqlDatetime);
      if (has("last_view_attempt_at")) {
        where.push("(last_view_attempt_at IS NULL OR last_view_attempt_at<?)");
        whereParams.push(normalized.utcSqlDatetime);
      }
      return {
        sql: `UPDATE campaign_posts
         SET ${set.join(",\n             ")}
         WHERE ${where.join("\n           AND ")}`,
        params: [...setParams, ...whereParams],
      };
    });
  };

  let out: QueryResult;
  try {
    out = await runAtomicUpdate(mode);
  } catch (error) {
    if (!isColumnTypeTruncationError(error)) throw error;
    mode = mode === "bigint" ? "datetime" : "bigint";
    columnModeCache.set(db as object, mode);
    out = await runAtomicUpdate(mode);
  }

  const affected = affectedRowsOf(out);
  // Unknown result => not reported as success (fail closed for audit/billing callers).
  const updated = affected !== null && affected > 0;
  return {
    updated,
    skippedStale: !updated,
    status: updated ? "success" : "stale_ignored",
    views: safeViews,
    epochMs: normalized.epochMs,
  };
}

/**
 * Persist a failed or terminal view-fetch attempt.
 *
 * A failure NEVER changes `views`, `settled_views`, `last_views_update` or `last_views_update_at`
 * (those describe the last CONFIRMED observation). Attempt time/status are tracked separately in
 * `last_view_attempt_at`. A failure that is older than or equal to the confirmed observation or an
 * already recorded attempt, or that targets a deleted/non-live placement, is ignored
 * (`skippedStale: true`), so it can never mask a newer success or touch a deleted record.
 */
export async function persistFailedChannelViewFetch(
  db: Pick<PoolConnection, "query">,
  postId: number,
  reason: string,
  source: string,
  observedAt: Date | string | number = Date.now(),
  retryAfterSeconds?: number | null,
) {
  const normalized = normalizeViewTimestamp(observedAt);
  const policy = classifyFailureFallback(reason, retryAfterSeconds);
  const status = policy.terminal ? "terminal" : "failed";
  const encodedError = encodeFailureFallback(reason, retryAfterSeconds);
  const nextRetryUtc = policy.retryAfterSeconds
    ? new Date(normalized.epochMs + policy.retryAfterSeconds * 1000).toISOString().replace("T", " ").replace("Z", "")
    : null;
  const normalizedStored = normalizedLastViewsUpdateDatetimeSql("last_views_update");

  const out = await runWithOptionalColumns(db, (has) => {
    const set: string[] = ["view_fetch_status=?", "view_fetch_error=?", "view_fetch_source=?"];
    const setParams: unknown[] = [status, encodedError, source];
    if (has("last_view_attempt_at")) { set.push("last_view_attempt_at=?"); setParams.push(normalized.utcSqlDatetime); }
    if (has("view_fetch_failures")) set.push("view_fetch_failures=COALESCE(view_fetch_failures,0)+1");
    if (has("last_view_failure_class")) { set.push("last_view_failure_class=?"); setParams.push(policy.classification); }
    if (has("view_next_retry_at")) { set.push("view_next_retry_at=?"); setParams.push(nextRetryUtc); }

    const where: string[] = ["id=?", LIVE_PLACEMENT_GUARD];
    const whereParams: unknown[] = [postId];
    where.push(`(${normalizedStored} IS NULL OR ${normalizedStored}<?)`);
    whereParams.push(normalized.utcSqlDatetime);
    if (has("last_views_update_at")) {
      where.push("(last_views_update_at IS NULL OR last_views_update_at<?)");
      whereParams.push(normalized.utcSqlDatetime);
    }
    if (has("last_view_attempt_at")) {
      where.push("(last_view_attempt_at IS NULL OR last_view_attempt_at<?)");
      whereParams.push(normalized.utcSqlDatetime);
    }
    return {
      sql: `UPDATE campaign_posts
         SET ${set.join(",\n             ")}
         WHERE ${where.join("\n           AND ")}`,
      params: [...setParams, ...whereParams],
    };
  });

  const affected = affectedRowsOf(out);
  // Unknown result => not reported as success (fail closed for audit/billing callers).
  const updated = affected !== null && affected > 0;
  return {
    updated,
    skippedStale: !updated,
    status: updated ? status : "stale_ignored",
    nextStatus: status,
    classification: policy.classification,
    failureClass: policy.classification,
    retryAfterSeconds: policy.retryAfterSeconds,
    terminal: updated ? policy.terminal : false,
  };
}
