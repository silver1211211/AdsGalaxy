import type { RowDataPacket } from "mysql2";
import type { ResultSetHeader } from "mysql2/promise";
import pool from "@/lib/db";

const DEFAULT_MAX_POSTS_PER_RUN = 500;
const MAX_DELETE_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;
const BATCH_DELAY_MS = 500;

type CleanupStatus = "pending" | "success" | "failed" | "retry";

type CampaignPostColumns = {
  hasDeletedAt: boolean;
  hasDeleteAttempts: boolean;
  hasDeleteFailedReason: boolean;
  hasDeleteFailedAt: boolean;
  hasCleanupAttemptedAt: boolean;
  hasCleanupStatus: boolean;
  hasCleanupCompletedAt: boolean;
  hasCleanupError: boolean;
  hasCleanupRetryCount: boolean;
  hasDeliveryConfirmedAt: boolean;
};

type ColumnRow = RowDataPacket & {
  COLUMN_NAME: string;
};

type CleanupPostRow = RowDataPacket & {
  id: number;
  campaign_id: number;
  campaign_type: string;
  message_id: number | null;
  channel_id: number | null;
  channel_username: string | null;
  chat_id: string | number | null;
};

type TelegramDeleteResponse = {
  ok?: boolean;
  description?: string;
};

type DeleteResult = {
  success: boolean;
  cleanupStatus: CleanupStatus;
  attemptsUsed: number;
  reason: string;
  code: string;
  retryable: boolean;
  alreadyDeleted: boolean;
  telegramResponse: string;
};

export type CampaignPostDeletionSummary = {
  checked: number;
  total: number;
  deleted: number;
  failed: number;
  retry: number;
  skipped: number;
  lifetimeHours?: number;
  failedIds: number[];
  details: Array<{
    id: number;
    campaign_id?: number;
    channel_id?: number | null;
    message_id?: number | null;
    status: string;
    attempts?: number;
    already_deleted?: boolean;
    cleanup_status?: CleanupStatus;
    error_code?: string;
    retryable?: boolean;
    reason?: string;
    telegram_response?: string;
  }>;
};

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isAlreadyDeletedError(description?: string) {
  const normalized = (description || "").toLowerCase();
  return normalized.includes("message to delete not found")
    || normalized.includes("message not found");
}

export function classifyTelegramDeleteError(description: string, httpStatus?: number): {
  code: string;
  retryable: boolean;
  nonFatal: boolean;
  reason: string;
} {
  const text = description.toLowerCase();
  const statusText = httpStatus ? `HTTP ${httpStatus}: ${description}` : description;

  if (text.includes("too many requests") || text.includes("retry after")) {
    return { code: "RATE_LIMITED", retryable: true, nonFatal: true, reason: `RATE_LIMITED: ${statusText}` };
  }
  if (text.includes("timeout") || text.includes("temporarily") || text.includes("internal server error") || text.includes("bad gateway")) {
    return { code: "TELEGRAM_TEMPORARY_ERROR", retryable: true, nonFatal: true, reason: `TELEGRAM_TEMPORARY_ERROR: ${statusText}` };
  }
  if (text.includes("message_id_invalid") || text.includes("message id invalid") || text.includes("message identifier is not valid")) {
    return { code: "MESSAGE_ID_INVALID", retryable: false, nonFatal: true, reason: `MESSAGE_ID_INVALID: ${statusText}` };
  }
  if (text.includes("message can't be deleted") || text.includes("message cannot be deleted") || text.includes("can't delete")) {
    return { code: "MESSAGE_CANT_BE_DELETED", retryable: false, nonFatal: true, reason: `MESSAGE_CANT_BE_DELETED: ${statusText}` };
  }
  if (text.includes("message to delete not found") || text.includes("message not found") || (httpStatus === 400 && text.includes("not found"))) {
    return { code: "MESSAGE_NOT_FOUND", retryable: false, nonFatal: true, reason: `MESSAGE_NOT_FOUND: ${statusText}` };
  }
  if (text.includes("channel_invalid") || text.includes("channel invalid")) {
    return { code: "CHANNEL_INVALID", retryable: false, nonFatal: true, reason: `CHANNEL_INVALID: ${statusText}` };
  }
  if (text.includes("peer_id_invalid") || text.includes("peer id invalid")) {
    return { code: "PEER_ID_INVALID", retryable: false, nonFatal: true, reason: `PEER_ID_INVALID: ${statusText}` };
  }
  if (text.includes("chat not found") || text.includes("channel not found")) {
    return { code: "CHAT_NOT_FOUND", retryable: false, nonFatal: true, reason: `CHAT_NOT_FOUND: ${statusText}` };
  }
  if (text.includes("not enough rights") || text.includes("not an administrator") || text.includes("administrator rights")) {
    return { code: "CHAT_ADMIN_REQUIRED", retryable: false, nonFatal: true, reason: `CHAT_ADMIN_REQUIRED: ${statusText}` };
  }
  if (text.includes("bot was kicked") || text.includes("bot was blocked") || text.includes("bot removed")) {
    return { code: "BOT_REMOVED", retryable: false, nonFatal: true, reason: `BOT_REMOVED: ${statusText}` };
  }
  if (text.includes("bot is not a member") || text.includes("bot is not member")) {
    return { code: "BOT_IS_NOT_MEMBER", retryable: false, nonFatal: true, reason: `BOT_IS_NOT_MEMBER: ${statusText}` };
  }
  if (httpStatus === 403 || text.includes("403 forbidden") || text.includes("forbidden")) {
    return { code: "403_FORBIDDEN", retryable: false, nonFatal: true, reason: `403_FORBIDDEN: ${statusText}` };
  }
  return { code: "TELEGRAM_DELETE_FAILED", retryable: false, nonFatal: true, reason: `TELEGRAM_DELETE_FAILED: ${statusText}` };
}

export async function getCampaignPostDeletionColumns(): Promise<CampaignPostColumns> {
  const [rows] = await pool.query<ColumnRow[]>(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'campaign_posts'
      AND COLUMN_NAME IN (
        'deleted_at', 'delete_attempts', 'delete_failed_reason', 'delete_failed_at',
        'cleanup_attempted_at', 'cleanup_status', 'cleanup_completed_at',
        'cleanup_error', 'cleanup_retry_count', 'delivery_confirmed_at'
      )
  `);

  const columns = new Set(rows.map(row => row.COLUMN_NAME));
  return {
    hasDeletedAt: columns.has("deleted_at"),
    hasDeleteAttempts: columns.has("delete_attempts"),
    hasDeleteFailedReason: columns.has("delete_failed_reason"),
    hasDeleteFailedAt: columns.has("delete_failed_at"),
    hasCleanupAttemptedAt: columns.has("cleanup_attempted_at"),
    hasCleanupStatus: columns.has("cleanup_status"),
    hasCleanupCompletedAt: columns.has("cleanup_completed_at"),
    hasCleanupError: columns.has("cleanup_error"),
    hasCleanupRetryCount: columns.has("cleanup_retry_count"),
    hasDeliveryConfirmedAt: columns.has("delivery_confirmed_at"),
  };
}

async function fetchDeletionBatch(options: {
  campaignId?: number | string;
  olderThan24Hours?: boolean;
  retryOnly?: boolean;
  lifetimeHours?: number;
  hasDeletedAt: boolean;
  hasCleanupStatus: boolean;
  hasDeliveryConfirmedAt: boolean;
  excludedChannelIds?: number[];
  batchSize: number;
}) {
  const filters = [
    options.retryOnly
      ? (options.hasCleanupStatus ? "(cp.cleanup_status = 'retry' OR cp.status = 'delete_failed')" : "cp.status = 'delete_failed'")
      : options.olderThan24Hours
        ? "cp.status = 'active'"
        : "cp.status IN ('active', 'posted', 'sent', 'delete_failed', 'cleanup_pending')",
  ];
  const params: Array<number | string | number[]> = [];

  if (options.olderThan24Hours) {
    const ageExpression = options.hasDeliveryConfirmedAt
      ? "COALESCE(cp.delivery_confirmed_at, cp.created_at)"
      : "cp.created_at";
    filters.push(`${ageExpression} <= DATE_SUB(NOW(), INTERVAL ? HOUR)`);
    params.push(options.lifetimeHours || 24);
    filters.push("cp.message_id IS NOT NULL AND TRIM(cp.message_id) <> ''");
    filters.push("cp.delivery_failed_at IS NULL");
    filters.push("(ch.chat_id IS NOT NULL OR (cp.channel_username IS NOT NULL AND TRIM(cp.channel_username) <> ''))");
    filters.push(`((c.type = 'views' AND COALESCE(cp.views, 0) <= COALESCE(cp.settled_views, 0))
      OR (c.type = 'clicks' AND (
        SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id = cp.id
      ) <= COALESCE(cp.settled_clicks, 0))
      OR c.type NOT IN ('views', 'clicks'))`);
    filters.push(`NOT EXISTS (
      SELECT 1 FROM channel_advertiser_debits cad
      WHERE cad.post_id = cp.id AND cad.publisher_status <> 'settled'
    )`);
  }

  if (options.hasDeletedAt) {
    filters.push("cp.deleted_at IS NULL");
  }

  if (options.campaignId !== undefined) {
    filters.push("cp.campaign_id = ?");
    params.push(options.campaignId);
  }

  if (options.excludedChannelIds?.length) {
    filters.push("(cp.channel_id IS NULL OR cp.channel_id NOT IN (?))");
    params.push(options.excludedChannelIds);
  }

  params.push(options.batchSize);

  const [posts] = await pool.query<CleanupPostRow[]>(`
    SELECT
      cp.id,
      cp.campaign_id,
      c.type AS campaign_type,
      cp.message_id,
      cp.channel_id,
      cp.channel_username,
      ch.chat_id
    FROM campaign_posts cp
    JOIN campaigns c ON c.id = cp.campaign_id
    LEFT JOIN channels ch ON ch.id = cp.channel_id
    WHERE ${filters.join(" AND ")}
    ORDER BY cp.created_at ASC
    LIMIT ?
  `, params);

  return posts;
}

async function expiredPostCounts(lifetimeHours: number, columns: CampaignPostColumns) {
  const ageExpression = columns.hasDeliveryConfirmedAt ? "COALESCE(cp.delivery_confirmed_at, cp.created_at)" : "cp.created_at";
  const deletedFilter = columns.hasDeletedAt ? "AND cp.deleted_at IS NULL" : "";
  const [rows] = await pool.query<Array<RowDataPacket & { total_expired: number | string; eligible: number | string; settlement_safe_eligible: number | string }>>(
    `SELECT COUNT(*) total_expired,
       SUM(cp.message_id IS NOT NULL AND TRIM(cp.message_id)<>''
         AND (ch.chat_id IS NOT NULL OR (cp.channel_username IS NOT NULL AND TRIM(cp.channel_username)<>''))) eligible,
       SUM(cp.message_id IS NOT NULL AND TRIM(cp.message_id)<>''
         AND (ch.chat_id IS NOT NULL OR (cp.channel_username IS NOT NULL AND TRIM(cp.channel_username)<>''))
         AND ((c.type = 'views' AND COALESCE(cp.views,0) <= COALESCE(cp.settled_views,0))
           OR (c.type = 'clicks' AND (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id=cp.id) <= COALESCE(cp.settled_clicks,0))
           OR c.type NOT IN ('views','clicks'))
         AND NOT EXISTS (
           SELECT 1 FROM channel_advertiser_debits cad
           WHERE cad.post_id = cp.id AND cad.publisher_status <> 'settled'
         )) settlement_safe_eligible
     FROM campaign_posts cp
     JOIN campaigns c ON c.id=cp.campaign_id
     LEFT JOIN channels ch ON ch.id=cp.channel_id
     WHERE cp.status='active' AND cp.delivery_failed_at IS NULL ${deletedFilter}
       AND ${ageExpression}<=DATE_SUB(NOW(),INTERVAL ? HOUR)`,
    [lifetimeHours]
  );
  return {
    total: Number(rows[0]?.total_expired || 0),
    eligible: Number(rows[0]?.eligible || 0),
    settlementSafeEligible: Number(rows[0]?.settlement_safe_eligible || 0),
  };
}

async function markCleanupPending(postId: number, columns: CampaignPostColumns) {
  const updates = ["status = 'cleanup_pending'"];
  if (columns.hasCleanupAttemptedAt) updates.push("cleanup_attempted_at = NOW()");
  if (columns.hasCleanupStatus) updates.push("cleanup_status = 'pending'");
  await pool.query(`UPDATE campaign_posts SET ${updates.join(", ")} WHERE id = ?`, [postId]);
}

async function recordDeleteSuccess(postId: number, attemptsUsed: number, columns: CampaignPostColumns, status: "deleted" | "replaced" | "already_missing") {
  const updates = ["status = ?"];
  const params: Array<number | string> = [];
  params.push(status);

  if (columns.hasDeletedAt) {
    updates.push("deleted_at = NOW()");
  }

  if (columns.hasDeleteAttempts) {
    updates.push("delete_attempts = ?");
    params.push(attemptsUsed);
  }

  if (columns.hasDeleteFailedReason) {
    updates.push("delete_failed_reason = NULL");
  }

  if (columns.hasDeleteFailedAt) updates.push("delete_failed_at = NULL");
  if (columns.hasCleanupAttemptedAt) updates.push("cleanup_attempted_at = NOW()");
  if (columns.hasCleanupStatus) updates.push("cleanup_status = 'success'");
  if (columns.hasCleanupCompletedAt) updates.push("cleanup_completed_at = NOW()");
  if (columns.hasCleanupError) updates.push("cleanup_error = NULL");

  params.push(postId);
  await pool.query(`UPDATE campaign_posts SET ${updates.join(", ")} WHERE id = ?`, params);
}

async function recordDeleteFailure(
  postId: number,
  attemptsUsed: number,
  reason: string,
  columns: CampaignPostColumns,
  cleanupStatus: "failed" | "retry" = "failed"
) {
  const updates = ["status = 'delete_failed'"];
  const params: Array<number | string> = [];

  if (columns.hasDeleteAttempts) {
    updates.push("delete_attempts = COALESCE(delete_attempts, 0) + ?");
    params.push(attemptsUsed);
  }

  if (columns.hasDeleteFailedReason) {
    updates.push("delete_failed_reason = ?");
    params.push(reason.slice(0, 2000));
  }

  if (columns.hasDeleteFailedAt) updates.push("delete_failed_at = NOW()");
  if (columns.hasCleanupAttemptedAt) updates.push("cleanup_attempted_at = NOW()");
  if (columns.hasCleanupStatus) {
    updates.push("cleanup_status = ?");
    params.push(cleanupStatus);
  }
  if (columns.hasCleanupError) {
    updates.push("cleanup_error = ?");
    params.push(reason.slice(0, 2000));
  }
  if (columns.hasCleanupRetryCount && cleanupStatus === "retry") {
    updates.push("cleanup_retry_count = COALESCE(cleanup_retry_count, 0) + 1");
  }

  params.push(postId);
  await pool.query(`UPDATE campaign_posts SET ${updates.join(", ")} WHERE id = ?`, params);
}

async function deletePostWithRetries(token: string | undefined, post: CleanupPostRow): Promise<DeleteResult> {
  if (!post.message_id) {
    return {
      success: true,
      cleanupStatus: "success",
      attemptsUsed: 0,
      reason: "Missing message_id; marked deleted locally.",
      code: "MESSAGE_ID_INVALID",
      retryable: false,
      alreadyDeleted: true,
      telegramResponse: "missing_message_id",
    };
  }

  const chatId = post.chat_id || (
    post.channel_username
      ? (post.channel_username.startsWith("@") ? post.channel_username : `@${post.channel_username}`)
      : null
  );

  if (!chatId) {
    return {
      success: false,
      cleanupStatus: "failed",
      attemptsUsed: 0,
      reason: "Missing chat_id and channel_username.",
      code: "CHAT_NOT_FOUND",
      retryable: false,
      alreadyDeleted: false,
      telegramResponse: "missing_chat_id_and_username",
    };
  }

  if (!token) {
    return {
      success: false,
      cleanupStatus: "retry",
      attemptsUsed: 0,
      reason: "BOT_TOKEN is missing; Telegram delete skipped.",
      code: "MISSING_BOT_TOKEN",
      retryable: true,
      alreadyDeleted: false,
      telegramResponse: "missing_bot_token",
    };
  }

  let lastReason = "Unknown Telegram delete failure";
  let lastCode = "TELEGRAM_DELETE_FAILED";
  let lastRetryable = false;
  let attemptsUsed = 0;

  for (let attempt = 1; attempt <= MAX_DELETE_ATTEMPTS; attempt++) {
    attemptsUsed = attempt;
    console.log(JSON.stringify({
      event: "telegram_post_delete_attempt",
      message: `Deleting campaign post ${post.id}`,
      post_id: post.id,
      campaign_id: post.campaign_id,
      channel_id: post.channel_id,
      attempt,
    }));

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: post.message_id }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json() as TelegramDeleteResponse;

      if (data.ok || isAlreadyDeletedError(data.description)) {
        const code = data.ok ? "OK" : "MESSAGE_NOT_FOUND";
        return {
          success: true,
          cleanupStatus: "success",
          attemptsUsed: attempt,
          reason: data.ok ? "Deleted successfully." : `MESSAGE_NOT_FOUND: ${data.description || "Message already deleted."}`,
          code,
          retryable: false,
          alreadyDeleted: !data.ok,
          telegramResponse: data.ok ? "ok" : String(data.description || "message_already_deleted"),
        };
      }

      const classification = classifyTelegramDeleteError(data.description || `Telegram API returned HTTP ${res.status}`, res.status);
      lastReason = classification.reason;
      lastCode = classification.code;
      lastRetryable = classification.retryable;
      if (!classification.retryable) break;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Telegram delete request failed";
      const classification = classifyTelegramDeleteError(message);
      lastReason = classification.reason;
      lastCode = classification.code;
      lastRetryable = classification.retryable;
    }

    if (attempt < MAX_DELETE_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS);
    }
  }

  return {
    success: false,
    cleanupStatus: lastRetryable ? "retry" : "failed",
    attemptsUsed,
    reason: lastReason,
    code: lastCode,
    retryable: lastRetryable,
    alreadyDeleted: false,
    telegramResponse: lastReason,
  };
}

export async function deleteCampaignPosts(options: {
  campaignId?: number | string;
  olderThan24Hours?: boolean;
  retryOnly?: boolean;
  lifetimeHours?: number;
  batchSize?: number;
  batchDelayMs?: number;
  maxPostsPerRun?: number;
  successStatus?: "deleted" | "replaced";
  excludedChannelIds?: number[];
}): Promise<CampaignPostDeletionSummary> {
  const token = process.env.BOT_TOKEN;

  const columns = await getCampaignPostDeletionColumns();
  const summary: CampaignPostDeletionSummary = {
    checked: 0,
    total: 0,
    deleted: 0,
    failed: 0,
    retry: 0,
    skipped: 0,
    failedIds: [],
    details: [],
  };

  const batchDelayMs = options.batchDelayMs ?? BATCH_DELAY_MS;
  const maxPostsPerRun = Math.min(500, Math.max(1, options.maxPostsPerRun || options.batchSize || DEFAULT_MAX_POSTS_PER_RUN));
  const lifetimeHours = Math.min(168, Math.max(1, options.lifetimeHours || 24));
  summary.lifetimeHours = options.olderThan24Hours ? lifetimeHours : undefined;
  const expiredCounts = options.olderThan24Hours ? await expiredPostCounts(lifetimeHours, columns) : null;
  const posts = await fetchDeletionBatch({
    campaignId: options.campaignId,
    olderThan24Hours: options.olderThan24Hours,
    retryOnly: options.retryOnly,
    lifetimeHours,
    hasDeletedAt: columns.hasDeletedAt,
    hasCleanupStatus: columns.hasCleanupStatus,
    hasDeliveryConfirmedAt: columns.hasDeliveryConfirmedAt,
    excludedChannelIds: options.excludedChannelIds,
    batchSize: maxPostsPerRun,
  });
  if (expiredCounts) {
    summary.skipped = Math.max(0, expiredCounts.total - posts.length);
    console.info(JSON.stringify({
      event: "expired_channel_post_cleanup_readiness",
      lifetime_hours: lifetimeHours,
      total_expired: expiredCounts.total,
      telegram_eligible: expiredCounts.eligible,
      settlement_safe_eligible: expiredCounts.settlementSafeEligible,
      selected_for_delete: posts.length,
      skipped: summary.skipped,
    }));
  }

  for (const post of posts) {
      summary.checked++;
      try {
        await markCleanupPending(post.id, columns);
        const result = await deletePostWithRetries(token, post);
        summary.total++;

        if (result.success) {
          const finalStatus = result.alreadyDeleted ? "already_missing" : (options.successStatus || "deleted");
          await recordDeleteSuccess(post.id, result.attemptsUsed, columns, finalStatus);
          summary.deleted++;
          summary.details.push({
            id: post.id,
            campaign_id: post.campaign_id,
            channel_id: post.channel_id,
            message_id: post.message_id,
            status: finalStatus,
            cleanup_status: "success",
            attempts: result.attemptsUsed,
            already_deleted: result.alreadyDeleted,
            error_code: result.code,
            retryable: false,
            telegram_response: result.telegramResponse,
          });
          console.log(JSON.stringify({
            event: "telegram_post_delete_success",
            post_id: post.id,
            campaign_id: post.campaign_id,
            channel_id: post.channel_id,
            attempts: result.attemptsUsed,
            already_deleted: result.alreadyDeleted,
            telegram_response: result.telegramResponse,
          }));
        } else {
          await recordDeleteFailure(post.id, result.attemptsUsed, result.reason, columns, result.cleanupStatus === "retry" ? "retry" : "failed");
          if (result.cleanupStatus === "retry") summary.retry++;
          else summary.failed++;
          summary.failedIds.push(post.id);
          summary.details.push({
            id: post.id,
            campaign_id: post.campaign_id,
            channel_id: post.channel_id,
            message_id: post.message_id,
            status: "delete_failed",
            cleanup_status: result.cleanupStatus,
            attempts: result.attemptsUsed,
            error_code: result.code,
            retryable: result.retryable,
            reason: result.reason,
            telegram_response: result.telegramResponse,
          });
          console.warn(JSON.stringify({
            event: "telegram_post_delete_failed",
            message: `Failed after ${result.attemptsUsed} attempts`,
            post_id: post.id,
            campaign_id: post.campaign_id,
            channel_id: post.channel_id,
            attempts: result.attemptsUsed,
            cleanup_status: result.cleanupStatus,
            error_code: result.code,
            retryable: result.retryable,
            reason: result.reason,
            telegram_response: result.telegramResponse,
          }));
        }
      } catch (postErr: unknown) {
        const reason = postErr instanceof Error ? postErr.message : "Unexpected cleanup error";
        await recordDeleteFailure(post.id, 0, reason, columns, "retry");
        summary.total++;
        summary.retry++;
        summary.failedIds.push(post.id);
        summary.details.push({
          id: post.id,
          campaign_id: post.campaign_id,
          channel_id: post.channel_id,
          message_id: post.message_id,
          status: "error",
          cleanup_status: "retry",
          error_code: "INTERNAL_CLEANUP_ERROR",
          retryable: true,
          reason,
        });
        console.error(JSON.stringify({
          event: "telegram_post_delete_unexpected_error",
          post_id: post.id,
          campaign_id: post.campaign_id,
          channel_id: post.channel_id,
          reason,
        }));
      }
      if (batchDelayMs > 0) await sleep(batchDelayMs);
  }

  return summary;
}

export async function deleteActiveCampaignPosts(campaignId: number | string) {
  return deleteCampaignPosts({ campaignId, batchSize: 100, maxPostsPerRun: 500 });
}

export async function retryCampaignPostCleanup(campaignId?: number | string) {
  return deleteCampaignPosts({ campaignId, retryOnly: true, batchSize: 100, maxPostsPerRun: 500 });
}

export async function getConfiguredPostLifetimeHours() {
  const [rows] = await pool.query<Array<RowDataPacket & { value: string }>>(
    "SELECT value FROM settings WHERE `key`='channel_post_lifetime_hours' LIMIT 1"
  );
  const configured = Number.parseInt(rows[0]?.value || process.env.CHANNEL_POST_LIFETIME_HOURS || "24", 10);
  return Math.min(168, Math.max(1, configured || 24));
}

export async function markStalePendingDeliveryPosts(timeoutMinutes: number) {
  const safeTimeoutMinutes = Math.max(1, Math.floor(timeoutMinutes || 10));
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE campaign_posts
     SET status = 'delivery_failed',
         delivery_failed_at = COALESCE(delivery_failed_at, NOW()),
         delivery_failure_reason = 'Pending delivery timed out before Telegram confirmation'
     WHERE status = 'pending_delivery'
       AND delivery_confirmed_at IS NULL
       AND created_at <= DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [safeTimeoutMinutes]
  );

  return {
    timeout_minutes: safeTimeoutMinutes,
    recovered: result.affectedRows,
  };
}
