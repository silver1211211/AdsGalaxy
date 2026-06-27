import type { RowDataPacket } from "mysql2";
import type { ResultSetHeader } from "mysql2/promise";
import pool from "@/lib/db";

const DEFAULT_BATCH_SIZE = 30;
const MAX_DELETE_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;
const BATCH_DELAY_MS = 500;

type CampaignPostColumns = {
  hasDeletedAt: boolean;
  hasDeleteAttempts: boolean;
  hasDeleteFailedReason: boolean;
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
};

export type CampaignPostDeletionSummary = {
  total: number;
  deleted: number;
  failed: number;
  failedIds: number[];
  details: Array<{
    id: number;
    status: string;
    attempts?: number;
    already_deleted?: boolean;
    reason?: string;
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
      AND COLUMN_NAME IN ('deleted_at', 'delete_attempts', 'delete_failed_reason')
  `);

  const columns = new Set(rows.map(row => row.COLUMN_NAME));
  return {
    hasDeletedAt: columns.has("deleted_at"),
    hasDeleteAttempts: columns.has("delete_attempts"),
    hasDeleteFailedReason: columns.has("delete_failed_reason"),
  };
}

async function fetchDeletionBatch(options: {
  campaignId?: number | string;
  olderThan24Hours?: boolean;
  hasDeletedAt: boolean;
  batchSize: number;
}) {
  const filters = ["cp.status = 'active'"];
  const params: Array<number | string> = [];

  if (options.olderThan24Hours) {
    filters.push("cp.created_at <= DATE_SUB(NOW(), INTERVAL 24 HOUR)");
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

  params.push(postId);
  await pool.query(`UPDATE campaign_posts SET ${updates.join(", ")} WHERE id = ?`, params);
}

async function recordDeleteFailure(postId: number, attemptsUsed: number, reason: string, columns: CampaignPostColumns) {
  const updates = ["status = 'delete_failed'"];
  const params: Array<number | string> = [];

  if (columns.hasDeleteAttempts) {
    updates.push("delete_attempts = ?");
    params.push(attemptsUsed);
  }

  if (columns.hasDeleteFailedReason) {
    updates.push("delete_failed_reason = ?");
    params.push(reason.slice(0, 2000));
  }

  params.push(postId);
  await pool.query(`UPDATE campaign_posts SET ${updates.join(", ")} WHERE id = ?`, params);
}

async function deletePostWithRetries(token: string, post: CleanupPostRow): Promise<DeleteResult> {
  if (!post.message_id) {
    return {
      success: true,
      attemptsUsed: 0,
      reason: "Missing message_id; marked deleted locally.",
      alreadyDeleted: true,
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
        body: JSON.stringify({ chat_id: chatId, message_id: post.message_id })
      });
      const data = await res.json() as TelegramDeleteResponse;

      if (data.ok || isAlreadyDeletedError(data.description)) {
        return {
          success: true,
          attemptsUsed: attempt,
          reason: data.ok ? "Deleted successfully." : (data.description || "Message already deleted."),
          alreadyDeleted: !data.ok,
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
  };
}

export async function deleteCampaignPosts(options: {
  campaignId?: number | string;
  olderThan24Hours?: boolean;
  batchSize?: number;
  batchDelayMs?: number;
}): Promise<CampaignPostDeletionSummary> {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is missing");

  const columns = await getCampaignPostDeletionColumns();
  const summary: CampaignPostDeletionSummary = {
    total: 0,
    deleted: 0,
    failed: 0,
    failedIds: [],
    details: [],
  };

  const batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
  const batchDelayMs = options.batchDelayMs ?? BATCH_DELAY_MS;

  while (true) {
    const posts = await fetchDeletionBatch({
      campaignId: options.campaignId,
      olderThan24Hours: options.olderThan24Hours,
      hasDeletedAt: columns.hasDeletedAt,
      batchSize,
    });

    if (posts.length === 0) break;

    for (const post of posts) {
      try {
        const result = await deletePostWithRetries(token, post);
        summary.total++;

        if (result.success) {
          await recordDeleteSuccess(post.id, result.attemptsUsed, columns);
          summary.deleted++;
          summary.details.push({ id: post.id, status: "deleted", attempts: result.attemptsUsed, already_deleted: result.alreadyDeleted });
          console.log(JSON.stringify({
            event: "telegram_post_delete_success",
            post_id: post.id,
            campaign_id: post.campaign_id,
            channel_id: post.channel_id,
            attempts: result.attemptsUsed,
            already_deleted: result.alreadyDeleted,
          }));
        } else {
          await recordDeleteFailure(post.id, result.attemptsUsed, result.reason, columns);
          summary.failed++;
          summary.failedIds.push(post.id);
          summary.details.push({ id: post.id, status: "delete_failed", attempts: result.attemptsUsed, reason: result.reason });
          console.warn(JSON.stringify({
            event: "telegram_post_delete_failed",
            message: `Failed after ${result.attemptsUsed} attempts`,
            post_id: post.id,
            campaign_id: post.campaign_id,
            channel_id: post.channel_id,
            attempts: result.attemptsUsed,
            reason: result.reason,
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
    }

    if (posts.length < batchSize) break;
    await sleep(batchDelayMs);
  }

  return summary;
}

export async function deleteActiveCampaignPosts(campaignId: number | string) {
  return deleteCampaignPosts({ campaignId });
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
