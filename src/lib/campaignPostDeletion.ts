import type { RowDataPacket } from "mysql2";
import type { ResultSetHeader } from "mysql2/promise";
import pool from "@/lib/db";

const DEFAULT_MAX_POSTS_PER_RUN = 500;
const MAX_DELETE_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;
const BATCH_DELAY_MS = 500;

type CampaignPostColumns = {
  hasDeletedAt: boolean;
  hasDeleteAttempts: boolean;
  hasDeleteFailedReason: boolean;
  hasDeleteFailedAt: boolean;
  hasDeliveryConfirmedAt: boolean;
};

type ColumnRow = RowDataPacket & {
  COLUMN_NAME: string;
};

type CleanupPostRow = RowDataPacket & {
  id: number;
  campaign_id: number;
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
  attemptsUsed: number;
  reason: string;
  alreadyDeleted: boolean;
  telegramResponse: string;
};

export type CampaignPostDeletionSummary = {
  checked: number;
  total: number;
  deleted: number;
  failed: number;
  skipped: number;
  lifetimeHours?: number;
  failedIds: number[];
  details: Array<{
    id: number;
    status: string;
    attempts?: number;
    already_deleted?: boolean;
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

export async function getCampaignPostDeletionColumns(): Promise<CampaignPostColumns> {
  const [rows] = await pool.query<ColumnRow[]>(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'campaign_posts'
      AND COLUMN_NAME IN ('deleted_at', 'delete_attempts', 'delete_failed_reason', 'delete_failed_at', 'delivery_confirmed_at')
  `);

  const columns = new Set(rows.map(row => row.COLUMN_NAME));
  return {
    hasDeletedAt: columns.has("deleted_at"),
    hasDeleteAttempts: columns.has("delete_attempts"),
    hasDeleteFailedReason: columns.has("delete_failed_reason"),
    hasDeleteFailedAt: columns.has("delete_failed_at"),
    hasDeliveryConfirmedAt: columns.has("delivery_confirmed_at"),
  };
}

async function fetchDeletionBatch(options: {
  campaignId?: number | string;
  olderThan24Hours?: boolean;
  lifetimeHours?: number;
  hasDeletedAt: boolean;
  hasDeliveryConfirmedAt: boolean;
  batchSize: number;
}) {
  const filters = [options.olderThan24Hours ? "cp.status = 'active'" : "cp.status IN ('active', 'posted', 'sent', 'delete_failed')"];
  const params: Array<number | string> = [];

  if (options.olderThan24Hours) {
    const ageExpression = options.hasDeliveryConfirmedAt
      ? "COALESCE(cp.delivery_confirmed_at, cp.created_at)"
      : "cp.created_at";
    filters.push(`${ageExpression} <= DATE_SUB(NOW(), INTERVAL ? HOUR)`);
    params.push(options.lifetimeHours || 24);
    filters.push("cp.message_id IS NOT NULL AND TRIM(cp.message_id) <> ''");
    filters.push("cp.delivery_failed_at IS NULL");
    filters.push("(ch.chat_id IS NOT NULL OR (cp.channel_username IS NOT NULL AND TRIM(cp.channel_username) <> ''))");
  }

  if (options.hasDeletedAt) {
    filters.push("cp.deleted_at IS NULL");
  }

  if (options.campaignId !== undefined) {
    filters.push("cp.campaign_id = ?");
    params.push(options.campaignId);
  }

  params.push(options.batchSize);

  const [posts] = await pool.query<CleanupPostRow[]>(`
    SELECT
      cp.id,
      cp.campaign_id,
      cp.message_id,
      cp.channel_id,
      cp.channel_username,
      ch.chat_id
    FROM campaign_posts cp
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
  const [rows] = await pool.query<Array<RowDataPacket & { total_expired: number | string; eligible: number | string }>>(
    `SELECT COUNT(*) total_expired,
       SUM(cp.message_id IS NOT NULL AND TRIM(cp.message_id)<>''
         AND (ch.chat_id IS NOT NULL OR (cp.channel_username IS NOT NULL AND TRIM(cp.channel_username)<>''))) eligible
     FROM campaign_posts cp LEFT JOIN channels ch ON ch.id=cp.channel_id
     WHERE cp.status='active' AND cp.delivery_failed_at IS NULL ${deletedFilter}
       AND ${ageExpression}<=DATE_SUB(NOW(),INTERVAL ? HOUR)`,
    [lifetimeHours]
  );
  return { total: Number(rows[0]?.total_expired || 0), eligible: Number(rows[0]?.eligible || 0) };
}

async function recordDeleteSuccess(postId: number, attemptsUsed: number, columns: CampaignPostColumns) {
  const updates = ["status = 'deleted'"];
  const params: Array<number | string> = [];

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

  params.push(postId);
  await pool.query(`UPDATE campaign_posts SET ${updates.join(", ")} WHERE id = ?`, params);
}

async function recordDeleteFailure(postId: number, attemptsUsed: number, reason: string, columns: CampaignPostColumns) {
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

  params.push(postId);
  await pool.query(`UPDATE campaign_posts SET ${updates.join(", ")} WHERE id = ?`, params);
}

async function deletePostWithRetries(token: string | undefined, post: CleanupPostRow): Promise<DeleteResult> {
  if (!post.message_id) {
    return {
      success: true,
      attemptsUsed: 0,
      reason: "Missing message_id; marked deleted locally.",
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
      attemptsUsed: 0,
      reason: "Missing chat_id and channel_username.",
      alreadyDeleted: false,
      telegramResponse: "missing_chat_id_and_username",
    };
  }

  if (!token) {
    return {
      success: false,
      attemptsUsed: 0,
      reason: "BOT_TOKEN is missing; Telegram delete skipped.",
      alreadyDeleted: false,
      telegramResponse: "missing_bot_token",
    };
  }

  let lastReason = "Unknown Telegram delete failure";

  for (let attempt = 1; attempt <= MAX_DELETE_ATTEMPTS; attempt++) {
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
        return {
          success: true,
          attemptsUsed: attempt,
          reason: data.ok ? "Deleted successfully." : (data.description || "Message already deleted."),
          alreadyDeleted: !data.ok,
          telegramResponse: data.ok ? "ok" : String(data.description || "message_already_deleted"),
        };
      }

      lastReason = data.description || `Telegram API returned HTTP ${res.status}`;
    } catch (err: unknown) {
      lastReason = err instanceof Error ? err.message : "Telegram delete request failed";
    }

    if (attempt < MAX_DELETE_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS);
    }
  }

  return {
    success: false,
    attemptsUsed: MAX_DELETE_ATTEMPTS,
    reason: lastReason,
    alreadyDeleted: false,
    telegramResponse: lastReason,
  };
}

export async function deleteCampaignPosts(options: {
  campaignId?: number | string;
  olderThan24Hours?: boolean;
  lifetimeHours?: number;
  batchSize?: number;
  batchDelayMs?: number;
  maxPostsPerRun?: number;
}): Promise<CampaignPostDeletionSummary> {
  const token = process.env.BOT_TOKEN;

  const columns = await getCampaignPostDeletionColumns();
  const summary: CampaignPostDeletionSummary = {
    checked: 0,
    total: 0,
    deleted: 0,
    failed: 0,
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
    lifetimeHours,
    hasDeletedAt: columns.hasDeletedAt,
    hasDeliveryConfirmedAt: columns.hasDeliveryConfirmedAt,
    batchSize: maxPostsPerRun,
  });
  if (expiredCounts) summary.skipped = Math.max(0, expiredCounts.total - posts.length);

  for (const post of posts) {
      summary.checked++;
      try {
        const result = await deletePostWithRetries(token, post);
        summary.total++;

        if (result.success) {
          await recordDeleteSuccess(post.id, result.attemptsUsed, columns);
          summary.deleted++;
          summary.details.push({ id: post.id, status: "deleted", attempts: result.attemptsUsed, already_deleted: result.alreadyDeleted, telegram_response: result.telegramResponse });
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
          await recordDeleteFailure(post.id, result.attemptsUsed, result.reason, columns);
          summary.failed++;
          summary.failedIds.push(post.id);
          summary.details.push({ id: post.id, status: "delete_failed", attempts: result.attemptsUsed, reason: result.reason, telegram_response: result.telegramResponse });
          console.warn(JSON.stringify({
            event: "telegram_post_delete_failed",
            message: `Failed after ${result.attemptsUsed} attempts`,
            post_id: post.id,
            campaign_id: post.campaign_id,
            channel_id: post.channel_id,
            attempts: result.attemptsUsed,
            reason: result.reason,
            telegram_response: result.telegramResponse,
          }));
        }
      } catch (postErr: unknown) {
        const reason = postErr instanceof Error ? postErr.message : "Unexpected cleanup error";
        await recordDeleteFailure(post.id, 0, reason, columns);
        summary.total++;
        summary.failed++;
        summary.failedIds.push(post.id);
        summary.details.push({ id: post.id, status: "error", reason });
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
