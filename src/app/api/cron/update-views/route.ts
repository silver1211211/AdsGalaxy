import { NextRequest, NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import { getChannelPrivacySchema } from "@/lib/channelPrivacy";
import { aggregateChannelStatistics } from "@/lib/channelStatistics";
import { getPrivatePostViews, mtprotoAccountNumber } from "@/lib/telegramMtproto";

export const dynamic = "force-dynamic";

type ViewPost = RowDataPacket & {
  id: number;
  channel_id: number;
  message_id: number | string;
  views: number | null;
  chat_id: string | null;
  channel_username: string | null;
  channel_type: "public" | "private";
  tracking_account: number | string | null;
};

type PublicViewResult =
  | { ok: true; views: number; source: "public_api" }
  | { ok: false; code: string };

type FetchStats = {
  postsChecked: number;
  viewsUpdated: number;
  publicViewsUpdated: number;
  privateViewsUpdated: number;
  failedPosts: number;
  telegramErrors: number;
  mtprotoErrors: number;
  publicPosts: number;
  privatePosts: number;
};

type BatchWorkload = RowDataPacket & {
  totalEligiblePosts: number | string | null;
  batchEligiblePosts: number | string | null;
  duePosts: number | string | null;
};

type SkipStats = {
  deletedPosts: number;
  deliveryFailedPosts: number;
  missingMessageIdPosts: number;
  inactiveChannels: number;
};

const VIEW_FETCH_BATCH_SIZE = Math.min(
  250,
  Math.max(1, Number.parseInt(process.env.VIEW_FETCH_BATCH_SIZE || "100", 10) || 100)
);
const VIEW_FETCH_DELAY_MS = Math.min(
  5_000,
  Math.max(250, Number.parseInt(process.env.VIEW_FETCH_DELAY_MS || "500", 10) || 500)
);

async function usesNumericViewTimestamp() {
  const [rows] = await pool.query<Array<RowDataPacket & { DATA_TYPE: string }>>(
    `SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaign_posts' AND COLUMN_NAME = 'last_views_update' LIMIT 1`
  );
  return ["bigint", "int", "decimal", "double", "float"].includes(String(rows[0]?.DATA_TYPE || "").toLowerCase());
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCode(error: unknown) {
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  return error instanceof Error ? error.message.slice(0, 120) : "unknown_error";
}

async function fetchPublicViews(username: string, messageId: number | string): Promise<PublicViewResult> {
  const baseUrl = process.env.PHP_VIEWS_API_URL || "https://php.adsgalaxy.online/views/api.php";
  const url = `${baseUrl}?channel=${encodeURIComponent(username.replace(/^@/, ""))}&post=${encodeURIComponent(String(messageId))}`;
  let lastCode = "public_api_failed";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
      const data = await response.json().catch(() => ({})) as { status?: string; views?: unknown };
      if (data.status === "success") {
        const views = Number.parseInt(String(data.views ?? ""), 10);
        return Number.isFinite(views) && views >= 0 ? { ok: true, views, source: "public_api" } : { ok: false, code: "invalid_view_count" };
      }
      lastCode = String(data.status || `public_api_http_${response.status}`).slice(0, 120);
    } catch (error) {
      lastCode = errorCode(error);
    }
    if (attempt === 0) await delay(350);
  }
  return { ok: false, code: lastCode };
}

async function refreshPublicUsername(chatId: string | null) {
  const token = process.env.BOT_TOKEN;
  if (!token || !chatId) return { username: null, error: "missing_bot_token_or_chat_id" };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId }),
      signal: AbortSignal.timeout(6_000),
    });
    const data = await response.json().catch(() => ({})) as { ok?: boolean; result?: { username?: string }; description?: string };
    return data.ok && data.result?.username
      ? { username: data.result.username, error: null }
      : { username: null, error: String(data.description || `getChat_http_${response.status}`).slice(0, 120) };
  } catch (error) {
    return { username: null, error: errorCode(error) };
  }
}

async function markFailure(post: ViewPost, reason: string, source: string, lastUpdateValue: number | Date) {
  await pool.query(
    `UPDATE campaign_posts SET last_views_update = ?, view_fetch_status = 'failed',
       view_fetch_error = ?, view_fetch_source = ? WHERE id = ?`,
    [lastUpdateValue, reason.slice(0, 500), source, post.id]
  );
}

async function getSkipStats(): Promise<SkipStats> {
  const [rows] = await pool.query<Array<RowDataPacket & SkipStats>>(
    `SELECT
       SUM(cp.status = 'deleted' OR cp.deleted_at IS NOT NULL) AS deletedPosts,
       SUM(cp.status = 'delivery_failed' OR cp.delivery_failed_at IS NOT NULL) AS deliveryFailedPosts,
       SUM(cp.message_id IS NULL OR TRIM(cp.message_id) = '' OR TRIM(cp.message_id) NOT REGEXP '^[1-9][0-9]*$') AS missingMessageIdPosts,
       SUM(ch.id IS NULL OR ch.status <> 'active' OR COALESCE(ch.is_deleted, FALSE) = TRUE) AS inactiveChannels
     FROM campaign_posts cp
     LEFT JOIN channels ch ON ch.id = cp.channel_id`
  );
  const row = rows[0];
  return {
    deletedPosts: Number(row?.deletedPosts || 0),
    deliveryFailedPosts: Number(row?.deliveryFailedPosts || 0),
    missingMessageIdPosts: Number(row?.missingMessageIdPosts || 0),
    inactiveChannels: Number(row?.inactiveChannels || 0),
  };
}

export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const lock = await acquireCronLock("update-views", 900);
  if (!lock) return NextResponse.json({ success: false, message: "Views update cron is already running" }, { status: 409 });

  const startedAt = new Date();
  const batchSlot = Math.floor(startedAt.getTime() / (15 * 60 * 1000)) % 4;
  const stats: FetchStats = { postsChecked: 0, viewsUpdated: 0, publicViewsUpdated: 0, privateViewsUpdated: 0, failedPosts: 0, telegramErrors: 0, mtprotoErrors: 0, publicPosts: 0, privatePosts: 0 };
  const errors: Array<{ post_id: number; source: string; reason: string }> = [];
  let runId: number | null = null;

  try {
    const [runResult] = await pool.query<ResultSetHeader>(
      "INSERT INTO channel_view_fetch_runs (batch_slot, started_at) VALUES (?, NOW())",
      [batchSlot]
    );
    runId = runResult.insertId;

    const privacy = await getChannelPrivacySchema();
    const skipped = await getSkipStats();
    console.info("Channel view fetch skipped posts", {
      deleted_posts: skipped.deletedPosts,
      delivery_failed_posts: skipped.deliveryFailedPosts,
      missing_message_id_posts: skipped.missingMessageIdPosts,
      inactive_or_deleted_channels: skipped.inactiveChannels,
    });
    const numericTimestamp = await usesNumericViewTimestamp();
    const lastUpdateValue = numericTimestamp ? Date.now() : new Date();
    const eligibility = numericTimestamp
      ? "(cp.last_views_update IS NULL OR cp.last_views_update < ?)"
      : "(cp.last_views_update IS NULL OR cp.last_views_update < DATE_SUB(NOW(), INTERVAL 45 MINUTE))";
    const channelType = privacy.hasChannelType ? "ch.channel_type" : "'public'";
    const trackingAccount = privacy.hasTrackingAccount ? "ch.tracking_account" : "NULL";
    const activePostConditions = `cp.status = 'active'
         AND cp.deleted_at IS NULL
         AND cp.delivery_failed_at IS NULL
         AND cp.delivery_confirmed_at IS NOT NULL
         AND cp.message_id IS NOT NULL
         AND TRIM(cp.message_id) <> ''
         AND TRIM(cp.message_id) REGEXP '^[1-9][0-9]*$'
         AND ch.status = 'active'
         AND COALESCE(ch.is_deleted, FALSE) = FALSE`;
    const workloadParams = numericTimestamp
      ? [batchSlot, batchSlot, Date.now() - 45 * 60 * 1000]
      : [batchSlot, batchSlot];
    const [workloadRows] = await pool.query<BatchWorkload[]>(
      `SELECT COUNT(*) AS totalEligiblePosts,
         SUM(MOD(cp.id, 4) = ?) AS batchEligiblePosts,
         SUM(MOD(cp.id, 4) = ? AND ${eligibility}) AS duePosts
       FROM campaign_posts cp
       JOIN channels ch ON ch.id = cp.channel_id
       WHERE ${activePostConditions}`,
      workloadParams
    );
    const totalEligiblePosts = Number(workloadRows[0]?.totalEligiblePosts || 0);
    const batchEligiblePosts = Number(workloadRows[0]?.batchEligiblePosts || 0);
    const duePosts = Number(workloadRows[0]?.duePosts || 0);
    const [posts] = await pool.query<ViewPost[]>(
      `SELECT cp.id, cp.channel_id, cp.message_id, cp.views, ch.chat_id,
         ch.username AS channel_username, ${channelType} AS channel_type, ${trackingAccount} AS tracking_account
       FROM campaign_posts cp
       JOIN channels ch ON ch.id = cp.channel_id
       WHERE ${activePostConditions}
         AND MOD(cp.id, 4) = ?
         AND ${eligibility}
       ORDER BY cp.last_views_update IS NULL DESC, cp.last_views_update ASC, cp.id ASC
       LIMIT ${VIEW_FETCH_BATCH_SIZE}`,
      numericTimestamp ? [batchSlot, Date.now() - 45 * 60 * 1000] : [batchSlot]
    );

    for (const post of posts) {
      stats.postsChecked += 1;
      if (post.channel_type === "private") stats.privatePosts += 1;
      else stats.publicPosts += 1;
      const previousViews = Math.max(0, Number(post.views || 0));
      let fetchedViews: number | null = null;
      let source = post.channel_type === "private" ? "mtproto_private" : "public_api";

      console.info("Channel view post checked", {
        post_id: post.id,
        channel_id: post.channel_id,
        channel_type: post.channel_type,
        message_id: post.message_id,
        old_views: previousViews,
      });

      try {
        if (post.channel_type === "private") {
          const result = await getPrivatePostViews(post.chat_id || "", post.message_id, {
            preferredAccount: post.tracking_account ? Number(post.tracking_account) : null,
            rotationSeed: post.id,
          });
          if (result.ok) {
            fetchedViews = result.views;
            if (privacy.hasViewTrackingStatus) await pool.query("UPDATE channels SET view_tracking_status = 'available' WHERE id = ?", [post.channel_id]);
            if (privacy.hasTrackingAccount && privacy.hasTrackingAccountStatus && privacy.hasTrackingAccountLastSuccessAt) {
              await pool.query(
                `UPDATE channels SET tracking_account = ?, tracking_account_status = 'active',
                   tracking_account_last_success_at = NOW(), tracking_account_last_failure_at = NULL,
                   tracking_account_failure_reason = NULL WHERE id = ?`,
                [mtprotoAccountNumber(result.account), post.channel_id]
              );
            }
          } else {
            stats.mtprotoErrors += 1;
            if (privacy.hasViewTrackingStatus) {
              const unavailable = ["missing_api_id", "missing_api_hash", "missing_account_sessions", "session_auth_error"].includes(result.code);
              await pool.query("UPDATE channels SET view_tracking_status = ? WHERE id = ?", [unavailable ? "unavailable" : "limited", post.channel_id]);
            }
            if (privacy.hasTrackingAccountStatus && privacy.hasTrackingAccountLastFailureAt && privacy.hasTrackingAccountFailureReason) {
              await pool.query(
                `UPDATE channels SET tracking_account_status = CASE WHEN tracking_account_status = 'active' THEN tracking_account_status ELSE 'failed' END,
                   tracking_account_last_failure_at = NOW(), tracking_account_failure_reason = ? WHERE id = ?`,
                [result.code.slice(0, 255), post.channel_id]
              );
            }
            console.error("Channel view MTProto error", {
              post_id: post.id,
              channel_id: post.channel_id,
              chat_id: post.chat_id,
              reason: result.code,
            });
            throw new Error(result.code);
          }
        } else {
          let username = String(post.channel_username || "").replace(/^@/, "");
          let result = username ? await fetchPublicViews(username, post.message_id) : { ok: false as const, code: "missing_public_username" };

          if (!result.ok && (result.code === "channel-not-found" || result.code === "missing_public_username")) {
            const refreshed = await refreshPublicUsername(post.chat_id);
            if (refreshed.username) {
              username = refreshed.username;
              await pool.query("UPDATE channels SET username = ? WHERE id = ?", [username, post.channel_id]);
              result = await fetchPublicViews(username, post.message_id);
            } else {
              stats.telegramErrors += 1;
              console.error("Channel view Telegram error", {
                post_id: post.id,
                channel_id: post.channel_id,
                chat_id: post.chat_id,
                reason: refreshed.error || "get_chat_failed",
              });
              errors.push({ post_id: post.id, source: "telegram_get_chat", reason: refreshed.error || "get_chat_failed" });
            }
          }

          if (result.ok) {
            fetchedViews = result.views;
          } else {
            console.warn("Channel view public fetch error", {
              post_id: post.id,
              channel_id: post.channel_id,
              username,
              reason: result.code,
            });
            const peer = username ? `@${username}` : post.chat_id || "";
            const fallback = await getPrivatePostViews(peer, post.message_id, { rotationSeed: post.id });
            if (fallback.ok) {
              fetchedViews = fallback.views;
              source = "mtproto_public_fallback";
            } else {
              stats.mtprotoErrors += 1;
              console.error("Channel view public and MTProto fallback error", {
                post_id: post.id,
                channel_id: post.channel_id,
                public_error: result.code,
                mtproto_error: fallback.code,
              });
              throw new Error(`${result.code}; mtproto:${fallback.code}`);
            }
          }
        }

        const monotonicViews = Math.max(previousViews, fetchedViews ?? 0);
        await pool.query(
          `UPDATE campaign_posts SET views = GREATEST(COALESCE(views, 0), ?), last_views_update = ?,
             view_fetch_status = 'success', view_fetch_error = NULL, view_fetch_source = ? WHERE id = ?`,
          [monotonicViews, lastUpdateValue, source, post.id]
        );
        console.info("Channel view post updated", {
          post_id: post.id,
          channel_id: post.channel_id,
          old_views: previousViews,
          fetched_views: fetchedViews,
          new_views: monotonicViews,
          source,
        });
        await pool.query(
          `INSERT INTO campaign_views_audit (post_id, channel_id, total_views, last_views_count, status)
           VALUES (?, ?, ?, ?, 'valid')`,
          [post.id, post.channel_id, monotonicViews, previousViews]
        );
        await pool.query("UPDATE channels SET last_successful_view_fetch_at=NOW() WHERE id=?", [post.channel_id]);
        stats.viewsUpdated += 1;
        if (post.channel_type === "private") stats.privateViewsUpdated += 1;
        else stats.publicViewsUpdated += 1;
      } catch (error) {
        const reason = errorCode(error);
        stats.failedPosts += 1;
        errors.push({ post_id: post.id, source, reason });
        console.error("Channel view post failed", {
          post_id: post.id,
          channel_id: post.channel_id,
          old_views: previousViews,
          source,
          reason,
        });
        await markFailure(post, reason, source, lastUpdateValue).catch((storageError) => {
          console.error("View fetch failure could not be stored", { post_id: post.id, error: errorCode(storageError) });
        });
      }

      await delay(VIEW_FETCH_DELAY_MS);
    }

    const skippedPosts = Math.max(0, batchEligiblePosts - stats.postsChecked);
    const capacityDeferredPosts = Math.max(0, duePosts - stats.postsChecked);
    const recentlyCheckedPosts = Math.max(0, batchEligiblePosts - duePosts);

    await pool.query(
      `UPDATE channel_view_fetch_runs SET posts_checked = ?, views_updated = ?, public_views_updated = ?,
         private_views_updated = ?, failed_posts = ?, telegram_errors = ?, mtproto_errors = ?,
         total_eligible_posts = ?, skipped_posts = ?, error_summary = ?, completed_at = NOW() WHERE id = ?`,
      [stats.postsChecked, stats.viewsUpdated, stats.publicViewsUpdated, stats.privateViewsUpdated,
        stats.failedPosts, stats.telegramErrors, stats.mtprotoErrors, totalEligiblePosts, skippedPosts,
        JSON.stringify(errors.slice(0, 100)), runId]
    );

    let statisticsAggregation: { stat_date: string; post_rows: number; channel_rows: number } | { error: string };
    try {
      const aggregation = await aggregateChannelStatistics();
      statisticsAggregation = {
        stat_date: aggregation.statDate,
        post_rows: aggregation.postRows,
        channel_rows: aggregation.channelRows,
      };
    } catch (aggregationError) {
      const aggregationMessage = errorCode(aggregationError);
      statisticsAggregation = { error: aggregationMessage };
      console.error("Post-view-fetch channel statistics aggregation failed", { run_id: runId, error: aggregationMessage });
    }

    const summary = {
      batch_index: batchSlot,
      total_eligible_posts: totalEligiblePosts,
      batch_eligible_posts: batchEligiblePosts,
      checked_posts: stats.postsChecked,
      updated_posts: stats.viewsUpdated,
      skipped_posts: skippedPosts,
      recently_checked_posts: recentlyCheckedPosts,
      capacity_deferred_posts: capacityDeferredPosts,
      failed_posts: stats.failedPosts,
      public_count: stats.publicPosts,
      private_count: stats.privatePosts,
      max_posts_per_run: VIEW_FETCH_BATCH_SIZE,
      delay_ms: VIEW_FETCH_DELAY_MS,
    };
    console.info("Channel view fetch batch complete", { run_id: runId, ...summary, telegram_errors: stats.telegramErrors, mtproto_errors: stats.mtprotoErrors });
    return NextResponse.json({ success: true, run_id: runId, ...summary, statistics_aggregation: statisticsAggregation, errors });
  } catch (error) {
    const reason = errorCode(error);
    if (runId) {
      await pool.query(
        "UPDATE channel_view_fetch_runs SET failed_posts = ?, error_summary = ?, completed_at = NOW() WHERE id = ?",
        [stats.failedPosts, JSON.stringify([{ reason }]), runId]
      ).catch(() => undefined);
    }
    console.error("Channel view fetch cron failed", { batch_slot: batchSlot, run_id: runId, error: reason });
    return NextResponse.json({ success: false, message: reason }, { status: 500 });
  } finally {
    await releaseCronLock(lock);
  }
}
