import { NextRequest, NextResponse } from "next/server";
import { channelViewCadenceSql } from "@/lib/channelViewCadence";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { persistSuccessfulChannelViews } from "@/lib/channelViewPersistence";
import { acquireCronLock, releaseCronLock, requireCronSecret } from "@/lib/cronSecurity";
import { CACHE_TTL_SECONDS, cacheGet, cacheSet, redisKeys } from "@/lib/redisCache";
import { debitConfirmedChannelViews } from "@/lib/channelFastBilling";
import { getChannelPrivacySchema } from "@/lib/channelPrivacy";
import { getMtprotoViewPoolAvailability, getPrivatePostViews, isMtprotoReauthenticationRequired, mtprotoAccountNumber } from "@/lib/telegramMtproto";
import { settleGrowthSeedViews } from "@/lib/channelGrowth";
import {
  PublicProviderCircuitBreaker,
  acceptedMonotonicViews,
  classifyPublicTransportError,
  classifyViewFailure,
  encodeViewFailure,
  hasExecutionBudget,
  normalizePublicViewResult,
  positiveInt,
  shouldFallbackPublicToMtproto,
  shouldRetryPublicImmediately,
  viewWorkerHealth,
  VIEW_SHARD_COUNT,
  type PublicViewResult,
} from "@/lib/channelViewPipeline";

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
  tracking_account_status: string | null;
  tracking_account_member_status: string | null;
  campaign_kind: string | null;
  campaign_type: string | null;
  campaign_status: string | null;
  settled_views: number | string | null;
  delivery_confirmed_at: Date | string | null;
};

type FetchStats = {
  postsChecked: number;
  viewsUpdated: number;
  publicViewsUpdated: number;
  privateViewsUpdated: number;
  failedPosts: number;
  telegramErrors: number;
  mtprotoErrors: number;
  mtprotoCalls: number;
  mtprotoRequestsAttempted: number;
  mtprotoSuccesses: number;
  mtprotoActualFailures: number;
  mtprotoAccountsSkippedCooldown: number;
  mtprotoRateLimited: number;
  publicFallbackAttempts: number;
  publicFallbackSuccesses: number;
  publicPosts: number;
  privatePosts: number;
  temporaryFailures: number;
  permanentFailures: number;
  publicNotFound: number;
  publicTimeout: number;
  publicProviderErrors: number;
  mtprotoNoAccountAvailable: number;
  mtprotoPeerErrors: number;
  billingTriggered: number;
  billingNoDelta: number;
  billingFailed: number;
};

type BatchWorkload = RowDataPacket & {
  totalEligiblePosts: number | string | null;
  batchEligiblePosts: number | string | null;
  duePosts: number | string | null;
};

type BacklogWorkload = RowDataPacket & {
  overdue1h: number | string | null;
  overdue3h: number | string | null;
  overdue6h: number | string | null;
  overdue12h: number | string | null;
  overdue24h: number | string | null;
  oldestDueAgeSeconds: number | string | null;
};

type ShardWorkload = RowDataPacket & {
  shard: number | string;
  eligible: number | string;
  due: number | string;
  oldestDueAgeSeconds: number | string | null;
};

type SkipStats = {
  deletedPosts: number;
  deliveryFailedPosts: number;
  missingMessageIdPosts: number;
  inactiveChannels: number;
};

const VIEW_FETCH_PAGE_SIZE = positiveInt(process.env.VIEW_FETCH_PAGE_SIZE || process.env.VIEW_FETCH_BATCH_SIZE, 100, 10, 250);
const VIEW_FETCH_MAX_POSTS = positiveInt(process.env.VIEW_FETCH_MAX_POSTS, 1_000, VIEW_FETCH_PAGE_SIZE, 2_000);
const VIEW_FETCH_MAX_RUN_MS = positiveInt(process.env.UPDATE_VIEWS_MAX_RUN_MS, 240_000, 30_000, 12 * 60_000);
const VIEW_FETCH_STOP_RESERVE_MS = positiveInt(process.env.UPDATE_VIEWS_STOP_RESERVE_MS, 12_000, 5_000, 60_000);
const VIEW_FETCH_DELAY_MS = positiveInt(process.env.VIEW_FETCH_DELAY_MS, 100, 0, 5_000);
const PUBLIC_VIEW_CONCURRENCY = positiveInt(process.env.PUBLIC_VIEW_CONCURRENCY, 4, 1, 8);
const VIEW_BACKLOG_WARNING_COUNT = positiveInt(process.env.VIEW_BACKLOG_WARNING_COUNT, 500, 1, 100_000);
const VIEW_BACKLOG_WARNING_AGE_SECONDS = positiveInt(process.env.VIEW_BACKLOG_WARNING_AGE_SECONDS, 60 * 60, 60, 7 * 24 * 60 * 60);
const PUBLIC_PROVIDER_BREAKER_FAILURES = positiveInt(process.env.PUBLIC_VIEW_BREAKER_FAILURES, 5, 2, 50);
const PUBLIC_PROVIDER_BREAKER_MS = positiveInt(process.env.PUBLIC_VIEW_BREAKER_MS, 60_000, 5_000, 10 * 60_000);

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

export function publicFallbackRetryDelayMs(randomValue = Math.random()) {
  const bounded = Math.min(1, Math.max(0, randomValue));
  return 750 + Math.floor(bounded * 751);
}

async function fetchPublicViews(username: string, messageId: number | string): Promise<PublicViewResult> {
  const baseUrl = process.env.PHP_VIEWS_API_URL || "https://php.adsgalaxy.online/views/api.php";
  const url = `${baseUrl}?channel=${encodeURIComponent(username.replace(/^@/, ""))}&post=${encodeURIComponent(String(messageId))}`;
  let lastResult: PublicViewResult = { ok: false, code: "retryable_unknown", rawCode: "public_api_failed" };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
      const data = await response.json().catch(() => null);
      lastResult = normalizePublicViewResult({
        httpStatus: response.status,
        responseOk: response.ok,
        payload: data,
        expectedChannel: username,
        expectedMessageId: messageId,
      });
      if (lastResult.ok || !shouldRetryPublicImmediately(lastResult)) return lastResult;
    } catch (error) {
      lastResult = classifyPublicTransportError(error);
    }
    if (attempt === 0 && shouldRetryPublicImmediately(lastResult)) await delay(publicFallbackRetryDelayMs());
  }
  return lastResult;
}

async function refreshPublicUsername(chatId: string | null) {
  const token = process.env.BOT_TOKEN;
  if (!token || !chatId) return { username: null, error: "missing_bot_token_or_chat_id" };
  const metadataKey = redisKeys.telegramChat(chatId);
  const cached = await cacheGet<{ username: string }>(metadataKey);
  if (cached.hit && cached.value.username) return { username: cached.value.username, error: null };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId }),
      signal: AbortSignal.timeout(6_000),
    });
    const data = await response.json().catch(() => ({})) as { ok?: boolean; result?: { username?: string }; description?: string };
    if (data.ok && data.result?.username) {
      const metadata = { username: data.result.username };
      await cacheSet(metadataKey, metadata, CACHE_TTL_SECONDS.TELEGRAM_METADATA);
      return { username: metadata.username, error: null };
    }
    return { username: null, error: String(data.description || `getChat_http_${response.status}`).slice(0, 120) };
  } catch (error) {
    return { username: null, error: errorCode(error) };
  }
}

async function markFailure(post: ViewPost, reason: string, source: string, lastUpdateValue: number | Date, retryAfterSeconds?: number | null) {
  const policy = classifyViewFailure(reason, retryAfterSeconds);
  await pool.query(
    `UPDATE campaign_posts SET last_views_update = ?, view_fetch_status = ?,
       view_fetch_error = ?, view_fetch_source = ? WHERE id = ?`,
    [lastUpdateValue, policy.terminal ? "terminal" : "failed", encodeViewFailure(reason, retryAfterSeconds), source, post.id]
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
  const stats: FetchStats = {
    postsChecked: 0,
    viewsUpdated: 0,
    publicViewsUpdated: 0,
    privateViewsUpdated: 0,
    failedPosts: 0,
    telegramErrors: 0,
    mtprotoErrors: 0,
    mtprotoCalls: 0,
    mtprotoRequestsAttempted: 0,
    mtprotoSuccesses: 0,
    mtprotoActualFailures: 0,
    mtprotoAccountsSkippedCooldown: 0,
    mtprotoRateLimited: 0,
    publicFallbackAttempts: 0,
    publicFallbackSuccesses: 0,
    publicPosts: 0,
    privatePosts: 0,
    temporaryFailures: 0,
    permanentFailures: 0,
    publicNotFound: 0,
    publicTimeout: 0,
    publicProviderErrors: 0,
    mtprotoNoAccountAvailable: 0,
    mtprotoPeerErrors: 0,
    billingTriggered: 0,
    billingNoDelta: 0,
    billingFailed: 0,
  };
  const errors: Array<{ post_id: number; source: string; reason: string }> = [];
  let runId: number | null = null;
  const providerBreaker = new PublicProviderCircuitBreaker(PUBLIC_PROVIDER_BREAKER_FAILURES, PUBLIC_PROVIDER_BREAKER_MS);
  let executionBudgetDeferred = 0;
  let pagesProcessed = 0;
  let earliestMtprotoRecoverySeconds: number | null = null;

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
    const lastUpdateOrder = numericTimestamp
      ? `CASE
          WHEN cp.last_views_update IS NULL OR cp.last_views_update = 0 THEN NULL
          WHEN cp.last_views_update >= 10000000000000
            THEN STR_TO_DATE(CAST(cp.last_views_update AS CHAR), '%Y%m%d%H%i%s')
          ELSE FROM_UNIXTIME(cp.last_views_update / 1000)
        END`
      : "cp.last_views_update";
    // No dedicated retry_at column exists. last_views_update remains the actual
    // attempt/success time; the next due time is derived from that timestamp plus
    // the centralized reason encoded in view_fetch_error. It is never written in
    // the future.
    const retryDelaySeconds = `CASE
      WHEN cp.view_fetch_status = 'failed' AND cp.view_fetch_error LIKE '%rate_limited%retry_after=%'
        THEN GREATEST(1, CAST(SUBSTRING_INDEX(cp.view_fetch_error, 'retry_after=', -1) AS UNSIGNED))
      WHEN cp.view_fetch_status = 'failed' AND cp.view_fetch_error REGEXP 'no_verified_private_member|channel_private|not_channel_member|expired_invite|channel_not_found|identity_mismatch'
        THEN 21600
      WHEN cp.view_fetch_status = 'failed' AND cp.view_fetch_error REGEXP 'timeout|network|provider|rpc|peer_entity|malformed|all_accounts'
        THEN 300
      WHEN cp.view_fetch_status = 'failed' THEN 900
      ELSE ${channelViewCadenceSql(privacy.hasChannelType ? "ch.channel_type='private' OR NULLIF(ch.username,'') IS NULL" : "NULLIF(ch.username,'') IS NULL")} END`;
    const eligibility = `(cp.view_fetch_status <> 'terminal' OR cp.view_fetch_status IS NULL)
      AND (cp.last_views_update IS NULL OR cp.last_views_update = 0
        OR TIMESTAMPDIFF(SECOND, ${lastUpdateOrder}, NOW()) >= ${retryDelaySeconds})`;
    const channelType = privacy.hasChannelType ? "ch.channel_type" : "'public'";
    const trackingAccount = privacy.hasTrackingAccount ? "ch.tracking_account" : "NULL";
    const trackingAccountStatus = privacy.hasTrackingAccountStatus ? "ch.tracking_account_status" : "NULL";
    const trackingMemberStatus = privacy.hasTrackingAccountMemberStatus ? "ch.tracking_account_member_status" : "NULL";
    const activePostConditions = `cp.status = 'active'
         AND cp.deleted_at IS NULL
         AND cp.delivery_failed_at IS NULL
         AND cp.delivery_confirmed_at IS NOT NULL
         AND cp.message_id IS NOT NULL
         AND TRIM(cp.message_id) <> ''
         AND TRIM(cp.message_id) REGEXP '^[1-9][0-9]*$'
         AND ch.status = 'active'
         AND COALESCE(ch.is_deleted, FALSE) = FALSE`;
    const [workloadRows] = await pool.query<BatchWorkload[]>(
      `SELECT COUNT(*) AS totalEligiblePosts,
         SUM(MOD(cp.id, 4) = ?) AS batchEligiblePosts,
         SUM(${eligibility}) AS duePosts
       FROM campaign_posts cp
       JOIN campaigns c ON c.id = cp.campaign_id
       JOIN channels ch ON ch.id = cp.channel_id
       WHERE ${activePostConditions}`,
      [batchSlot]
    );
    const totalEligiblePosts = Number(workloadRows[0]?.totalEligiblePosts || 0);
    const batchEligiblePosts = Number(workloadRows[0]?.batchEligiblePosts || 0);
    const duePosts = Number(workloadRows[0]?.duePosts || 0);
    const [backlogRows] = await pool.query<BacklogWorkload[]>(
      `SELECT
         SUM(TIMESTAMPDIFF(HOUR, ${lastUpdateOrder}, NOW()) >= 1) overdue1h,
         SUM(TIMESTAMPDIFF(HOUR, ${lastUpdateOrder}, NOW()) >= 3) overdue3h,
         SUM(TIMESTAMPDIFF(HOUR, ${lastUpdateOrder}, NOW()) >= 6) overdue6h,
         SUM(TIMESTAMPDIFF(HOUR, ${lastUpdateOrder}, NOW()) >= 12) overdue12h,
         SUM(TIMESTAMPDIFF(HOUR, ${lastUpdateOrder}, NOW()) >= 24) overdue24h,
         COALESCE(MAX(TIMESTAMPDIFF(SECOND, ${lastUpdateOrder}, NOW())), 0) oldestDueAgeSeconds
       FROM campaign_posts cp
       JOIN campaigns c ON c.id=cp.campaign_id
       JOIN channels ch ON ch.id=cp.channel_id
       WHERE ${activePostConditions} AND ${eligibility}`
    );
    const backlog = backlogRows[0] || {} as BacklogWorkload;
    const [shardRows] = await pool.query<ShardWorkload[]>(
      `SELECT MOD(cp.id, ${VIEW_SHARD_COUNT}) shard, COUNT(*) eligible,
         SUM(${eligibility}) due,
         COALESCE(MAX(CASE WHEN ${eligibility} THEN TIMESTAMPDIFF(SECOND, ${lastUpdateOrder}, NOW()) ELSE 0 END),0) oldestDueAgeSeconds
       FROM campaign_posts cp
       JOIN campaigns c ON c.id=cp.campaign_id
       JOIN channels ch ON ch.id=cp.channel_id
       WHERE ${activePostConditions}
       GROUP BY MOD(cp.id, ${VIEW_SHARD_COUNT}) ORDER BY shard`
    );
    const processedPostIds = new Set<number>();
    const processedByShard = new Map<number, number>();
    const emptyShards = new Set<number>();
    let stopTakingWork = false;

    while (stats.postsChecked < VIEW_FETCH_MAX_POSTS && !stopTakingWork) {
      if (!hasExecutionBudget(startedAt.getTime(), VIEW_FETCH_MAX_RUN_MS, VIEW_FETCH_STOP_RESERVE_MS)) {
        executionBudgetDeferred = Math.max(0, duePosts - stats.postsChecked);
        break;
      }
      const pageShard = (batchSlot + pagesProcessed) % VIEW_SHARD_COUNT;
      const pageLimit = Math.min(VIEW_FETCH_PAGE_SIZE, VIEW_FETCH_MAX_POSTS - stats.postsChecked);
      const [posts] = await pool.query<ViewPost[]>(
      `SELECT cp.id, cp.channel_id, cp.message_id, cp.views, ch.chat_id, c.campaign_kind,
         c.type AS campaign_type, c.status AS campaign_status, cp.settled_views, cp.delivery_confirmed_at,
         ch.username AS channel_username, ${channelType} AS channel_type, ${trackingAccount} AS tracking_account,
         ${trackingAccountStatus} AS tracking_account_status,${trackingMemberStatus} AS tracking_account_member_status
       FROM campaign_posts cp
       JOIN campaigns c ON c.id = cp.campaign_id
       JOIN channels ch ON ch.id = cp.channel_id
       WHERE ${activePostConditions}
         AND MOD(cp.id, ${VIEW_SHARD_COUNT}) = ?
         AND ${eligibility}
         AND cp.id NOT IN (${processedPostIds.size ? [...processedPostIds].map(() => "?").join(",") : "0"})
       ORDER BY (cp.last_views_update IS NULL OR cp.last_views_update = 0) DESC,
         (c.type = 'views' AND c.status IN ('active','daily_cap_reached')) DESC,
         (COALESCE(cp.views,0) > COALESCE(cp.settled_views,0)) DESC,
         ${lastUpdateOrder} ASC, cp.delivery_confirmed_at ASC, cp.id ASC
       LIMIT ${pageLimit}`,
      [pageShard, ...processedPostIds]
      );
      pagesProcessed += 1;
      if (!posts.length) {
        emptyShards.add(pageShard);
        if (emptyShards.size === VIEW_SHARD_COUNT) break;
        continue;
      }
      emptyShards.delete(pageShard);

    let pageCursor = 0;
    const processPageWorker = async () => {
    while (!stopTakingWork) {
      const post = posts[pageCursor];
      pageCursor += 1;
      if (!post) return;
      if (!hasExecutionBudget(startedAt.getTime(), VIEW_FETCH_MAX_RUN_MS, VIEW_FETCH_STOP_RESERVE_MS)) {
        stopTakingWork = true;
        executionBudgetDeferred = Math.max(0, duePosts - stats.postsChecked);
        return;
      }
      processedPostIds.add(Number(post.id));
      processedByShard.set(Number(post.id) % VIEW_SHARD_COUNT, (processedByShard.get(Number(post.id) % VIEW_SHARD_COUNT) || 0) + 1);
      stats.postsChecked += 1;
      if (post.channel_type === "private") stats.privatePosts += 1;
      else stats.publicPosts += 1;
      const previousViews = Math.max(0, Number(post.views || 0));
      let fetchedViews: number | null = null;
      let source = post.channel_type === "private" ? "mtproto_private" : "public_api";
      let selectedAccount: number | null = null;
      let verifiedAccounts: number[] = [];
      let attemptedAccounts: number[] = [];
      let cooldownAccounts: number[] = [];
      let retryAfterSeconds: number | null = null;
      let fallbackAttempted = false;

      try {
        if (post.channel_type === "private") {
          const mtprotoPool = getMtprotoViewPoolAvailability();
          const result = mtprotoPool.availableAccounts.length === 0
            ? {
                ok: false as const,
                code: mtprotoPool.code || "all_accounts_unavailable",
                verifiedAccounts: [], attemptedAccounts: [], cooldownAccounts: mtprotoPool.unavailableAccounts.map((item) => item.account),
                requestsAttempted: 0, actualFailures: 0, retryAfterSeconds: mtprotoPool.retryAfterSeconds,
              }
            : await getPrivatePostViews(post.chat_id || "", post.message_id, {
                preferredAccount: Number(post.tracking_account) || null,
                rotationSeed: post.channel_id,
                verifyPrivateMembership: true,
              });
          verifiedAccounts = result.verifiedAccounts || [];
          attemptedAccounts = result.attemptedAccounts || [];
          cooldownAccounts = result.cooldownAccounts || [];
          retryAfterSeconds = result.retryAfterSeconds || null;
          stats.mtprotoCalls += 1;
          stats.mtprotoRequestsAttempted += result.requestsAttempted;
          stats.mtprotoActualFailures += result.actualFailures;
          stats.mtprotoAccountsSkippedCooldown += result.cooldownAccounts.length;
          if (result.ok) {
            stats.mtprotoSuccesses += 1;
            fetchedViews = result.views;
            selectedAccount = mtprotoAccountNumber(result.account);
            if (privacy.hasViewTrackingStatus) await pool.query("UPDATE channels SET view_tracking_status = 'available' WHERE id = ?", [post.channel_id]);
            if (privacy.hasTrackingAccount && privacy.hasTrackingAccountStatus && privacy.hasTrackingAccountLastSuccessAt) {
              await pool.query(
                `UPDATE channels SET tracking_account = ?, tracking_account_status = 'active',
                   ${privacy.hasTrackingAccountMemberStatus ? "tracking_account_member_status = 'member'," : ""}
                   tracking_account_last_success_at = NOW(), tracking_account_last_failure_at = NULL,
                   tracking_account_failure_reason = NULL WHERE id = ?`,
                [mtprotoAccountNumber(result.account), post.channel_id]
              );
            }
          } else {
            stats.mtprotoErrors += result.actualFailures;
            if (result.code === "rate_limited") stats.mtprotoRateLimited += 1;
            if (result.attemptedAccounts.length === 0) stats.mtprotoNoAccountAvailable += 1;
            if (/peer|channel_private|no_verified_private_member|message_id_invalid/.test(result.code)) stats.mtprotoPeerErrors += 1;
            if (result.retryAfterSeconds) earliestMtprotoRecoverySeconds = earliestMtprotoRecoverySeconds === null
              ? result.retryAfterSeconds
              : Math.min(earliestMtprotoRecoverySeconds, result.retryAfterSeconds);
            if (privacy.hasViewTrackingStatus) {
              const unavailable = ["missing_api_id", "missing_api_hash", "missing_account_sessions"].includes(result.code)
                || result.code === "all_accounts_unhealthy"
                || isMtprotoReauthenticationRequired(result.code);
              await pool.query("UPDATE channels SET view_tracking_status = ? WHERE id = ?", [unavailable ? "unavailable" : "limited", post.channel_id]);
            }
            if (result.code === 'rate_limited' && privacy.hasTrackingAccountLastFailureAt && privacy.hasTrackingAccountFailureReason) {
              await pool.query(
                `UPDATE channels SET tracking_account_last_failure_at = NOW(),
                   tracking_account_failure_reason = 'rate_limited' WHERE id = ?`,
                [post.channel_id]
              );
            } else if (privacy.hasTrackingAccountStatus && privacy.hasTrackingAccountLastFailureAt && privacy.hasTrackingAccountFailureReason) {
              await pool.query(
                `UPDATE channels SET tracking_account_status = 'failed',
                   ${privacy.hasTrackingAccountMemberStatus ? "tracking_account_member_status = CASE WHEN ? = 'no_verified_private_member' THEN 'not_member' ELSE tracking_account_member_status END," : ""}
                   tracking_account_last_failure_at = NOW(), tracking_account_failure_reason = ? WHERE id = ?`,
                [...(privacy.hasTrackingAccountMemberStatus ? [result.code] : []), result.code.slice(0, 255), post.channel_id]
              );
            }
            console.error("Channel view MTProto error", {
              post_id: post.id,
              channel_id: post.channel_id,
              chat_id: post.chat_id,
              reason: result.code,
              verified_accounts: verifiedAccounts,
              attempted_accounts: attemptedAccounts,
              cooldown_accounts: cooldownAccounts,
              flood_wait_seconds: retryAfterSeconds,
            });
            throw new Error(result.code);
          }
        } else {
          let username = String(post.channel_username || "").replace(/^@/, "");
          // Public posts use the stateless public endpoint first. MTProto is a
          // scarce, account-scoped fallback and must not be consumed for every
          // ordinary public refresh.
          stats.publicFallbackAttempts += 1;
          let result: PublicViewResult = !providerBreaker.canRequest()
            ? { ok: false, code: "provider_error", rawCode: "circuit_open" }
            : username
              ? await fetchPublicViews(username, post.message_id)
              : { ok: false, code: "channel_not_found", rawCode: "missing_public_username" };
          providerBreaker.record(result);

          if (!result.ok && result.code === "channel_not_found") {
            const refreshed = await refreshPublicUsername(post.chat_id);
            if (refreshed.username) {
              username = refreshed.username;
              await pool.query("UPDATE channels SET username = ? WHERE id = ?", [username, post.channel_id]);
              stats.publicFallbackAttempts += 1;
              result = await fetchPublicViews(username, post.message_id);
              providerBreaker.record(result);
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
            stats.publicFallbackSuccesses += 1;
            fetchedViews = result.views;
            source = "public_api";
          } else {
            if (result.code === "genuine_post_not_found") stats.publicNotFound += 1;
            if (result.code === "timeout") stats.publicTimeout += 1;
            if (["provider_error", "network_error", "malformed_response", "retryable_unknown"].includes(result.code)) stats.publicProviderErrors += 1;
            if (!shouldFallbackPublicToMtproto(result)) throw new Error(`public:${result.code}`);
            fallbackAttempted = true;
            const peer = username ? `@${username}` : post.chat_id || "";
            const mtprotoPool = getMtprotoViewPoolAvailability();
            const mtproto = mtprotoPool.availableAccounts.length === 0
              ? {
                  ok: false as const,
                  code: mtprotoPool.code || "all_accounts_unavailable",
                  verifiedAccounts: [], attemptedAccounts: [], cooldownAccounts: mtprotoPool.unavailableAccounts.map((item) => item.account),
                  requestsAttempted: 0, actualFailures: 0, retryAfterSeconds: mtprotoPool.retryAfterSeconds,
                }
              : await getPrivatePostViews(peer, post.message_id, { rotationSeed: post.id });
            attemptedAccounts = mtproto.attemptedAccounts || [];
            cooldownAccounts = mtproto.cooldownAccounts || [];
            retryAfterSeconds = mtproto.retryAfterSeconds || null;
            stats.mtprotoCalls += 1;
            stats.mtprotoRequestsAttempted += mtproto.requestsAttempted;
            stats.mtprotoActualFailures += mtproto.actualFailures;
            stats.mtprotoAccountsSkippedCooldown += mtproto.cooldownAccounts.length;
            if (mtproto.ok) {
              stats.mtprotoSuccesses += 1;
              fetchedViews = mtproto.views;
              source = "mtproto_public_fallback";
              selectedAccount = mtprotoAccountNumber(mtproto.account);
            } else {
              stats.mtprotoErrors += mtproto.actualFailures;
              if (mtproto.code === "rate_limited") stats.mtprotoRateLimited += 1;
              if (mtproto.attemptedAccounts.length === 0) stats.mtprotoNoAccountAvailable += 1;
              if (/peer|channel_private|no_verified_private_member|message_id_invalid/.test(mtproto.code)) stats.mtprotoPeerErrors += 1;
              if (mtproto.retryAfterSeconds) earliestMtprotoRecoverySeconds = earliestMtprotoRecoverySeconds === null
                ? mtproto.retryAfterSeconds
                : Math.min(earliestMtprotoRecoverySeconds, mtproto.retryAfterSeconds);
            }

            if (!mtproto.ok) {
            const publicErrorCode = result.ok ? "unknown_public_error" : result.code;
            console.warn("Channel view public fetch error", {
              post_id: post.id,
              channel_id: post.channel_id,
              username,
              reason: publicErrorCode,
            });
            console.error("Channel view MTProto and public fallback error", {
              post_id: post.id,
              channel_id: post.channel_id,
              mtproto_error: mtproto.code,
              public_error: publicErrorCode,
            });
            throw new Error(`mtproto:${mtproto.code}; public:${publicErrorCode}`);
            }
          }
        }

        const monotonicViews = acceptedMonotonicViews(previousViews, fetchedViews ?? -1);
        await persistSuccessfulChannelViews(pool, post.id, monotonicViews, source, lastUpdateValue);
        console.info("Channel view post updated", {
          post_id: post.id,
          channel_id: post.channel_id,
          chat_id: post.chat_id,
          channel_type: post.channel_type,
          selected_account: selectedAccount,
          verified_member: post.channel_type === "private" ? selectedAccount !== null && verifiedAccounts.includes(selectedAccount) : null,
          verified_accounts: verifiedAccounts,
          attempted_accounts: attemptedAccounts,
          cooldown_accounts: cooldownAccounts,
          retry_after_seconds: retryAfterSeconds,
          fallback_attempted: fallbackAttempted,
          old_views: previousViews,
          fetched_views: fetchedViews,
          accepted_views: monotonicViews,
          source,
        });
        await pool.query(
          `INSERT INTO campaign_views_audit (post_id, channel_id, total_views, last_views_count, status)
           VALUES (?, ?, ?, ?, 'valid')`,
          [post.id, post.channel_id, monotonicViews, previousViews]
        ).catch(error => console.error("channel_view_audit_failed", { post_id: post.id, error }));
        await pool.query("UPDATE channels SET last_successful_view_fetch_at=NOW() WHERE id=?", [post.channel_id])
          .catch(error => console.error("channel_view_diagnostic_failed", { post_id: post.id, error }));
        if (post.campaign_kind === "channel_growth" || post.campaign_type === "views") {
          stats.billingTriggered += 1;
          try {
            if (post.campaign_kind === "channel_growth") {
              await settleGrowthSeedViews(Number(post.id), monotonicViews);
            } else {
              const billing = await debitConfirmedChannelViews(Number(post.id), monotonicViews);
              if (!billing.debited || billing.units === 0) stats.billingNoDelta += 1;
            }
          } catch (billingError) {
            // The confirmed monotonic view count is already durable. Keep it
            // discoverable as views > settled_views for the canonical billing
            // service to recover later; Prompt 7 owns global financial retries.
            stats.billingFailed += 1;
            console.error("Channel view billing trigger failed", {
              post_id: post.id,
              channel_id: post.channel_id,
              confirmed_views: monotonicViews,
              settled_views: Number(post.settled_views || 0),
              reason: errorCode(billingError),
            });
            errors.push({ post_id: post.id, source: "view_billing", reason: errorCode(billingError) });
          }
        }
        stats.viewsUpdated += 1;
        if (post.channel_type === "private") stats.privateViewsUpdated += 1;
        else stats.publicViewsUpdated += 1;
      } catch (error) {
        const reason = errorCode(error);
        const failurePolicy = classifyViewFailure(reason, retryAfterSeconds);
        const failureUpdateValue = numericTimestamp ? Date.now() : new Date();
        if (failurePolicy.terminal) stats.permanentFailures += 1;
        else stats.temporaryFailures += 1;
        stats.failedPosts += 1;
        errors.push({ post_id: post.id, source, reason });
        console.error("Channel view post failed", {
          post_id: post.id,
          channel_id: post.channel_id,
          old_views: previousViews,
          source,
          reason,
          selected_account: selectedAccount,
          verified_accounts: verifiedAccounts,
          attempted_accounts: attemptedAccounts,
          cooldown_accounts: cooldownAccounts,
          retry_after_seconds: retryAfterSeconds,
          fallback_attempted: fallbackAttempted,
        });
        await markFailure(post, reason, source, failureUpdateValue, retryAfterSeconds).catch((storageError) => {
          console.error("View fetch failure could not be stored", { post_id: post.id, error: errorCode(storageError) });
        });
      }

      await delay(VIEW_FETCH_DELAY_MS);
    }
    };
    await Promise.all(Array.from({ length: Math.min(PUBLIC_VIEW_CONCURRENCY, posts.length) }, () => processPageWorker()));
    }

    const skippedPosts = Math.max(0, totalEligiblePosts - stats.postsChecked);
    const capacityDeferredPosts = Math.max(0, duePosts - stats.postsChecked);
    const recentlyCheckedPosts = Math.max(0, totalEligiblePosts - duePosts);
    const completedAt = new Date();
    const oldestDeferredAgeSeconds = Math.max(0, Number(backlog.oldestDueAgeSeconds || 0));
    const providerUnavailableUntil = providerBreaker.unavailableUntil();
    const health = viewWorkerHealth({
      overdue: capacityDeferredPosts,
      oldestDeferredAgeSeconds,
      temporaryFailures: stats.temporaryFailures,
      mtprotoUnavailable: stats.mtprotoNoAccountAvailable > 0 && stats.mtprotoSuccesses === 0,
      publicProviderDegraded: Boolean(providerUnavailableUntil),
      warningBacklog: VIEW_BACKLOG_WARNING_COUNT,
      warningAgeSeconds: VIEW_BACKLOG_WARNING_AGE_SECONDS,
    });

    await pool.query(
      `UPDATE channel_view_fetch_runs SET posts_checked = ?, views_updated = ?, public_views_updated = ?,
         private_views_updated = ?, failed_posts = ?, telegram_errors = ?, mtproto_errors = ?,
         total_eligible_posts = ?, skipped_posts = ?, error_summary = ?, completed_at = NOW() WHERE id = ?`,
      [stats.postsChecked, stats.viewsUpdated, stats.publicViewsUpdated, stats.privateViewsUpdated,
        stats.failedPosts, stats.telegramErrors, stats.mtprotoErrors, totalEligiblePosts, skippedPosts,
        JSON.stringify(errors.slice(0, 100)), runId]
    );

    // Raw campaign_posts views are persisted immediately above. Publisher daily
    // rollups deliberately remain on the hourly channel-settlement schedule.
    const statisticsAggregation = { skipped: true, reason: "hourly_channel_settlement_job" };

    const summary = {
      status: health,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      duration_ms: completedAt.getTime() - startedAt.getTime(),
      starting_shard: batchSlot,
      shard_count: VIEW_SHARD_COUNT,
      pages_processed: pagesProcessed,
      total_eligible_posts: totalEligiblePosts,
      batch_eligible_posts: batchEligiblePosts,
      checked_posts: stats.postsChecked,
      updated_posts: stats.viewsUpdated,
      skipped_posts: skippedPosts,
      recently_checked_posts: recentlyCheckedPosts,
      capacity_deferred_posts: capacityDeferredPosts,
      execution_budget_deferred: executionBudgetDeferred,
      oldest_deferred_age_seconds: oldestDeferredAgeSeconds,
      failed_posts: stats.failedPosts,
      temporary_failures: stats.temporaryFailures,
      permanent_failures: stats.permanentFailures,
      public_count: stats.publicPosts,
      private_count: stats.privatePosts,
      max_posts_per_run: VIEW_FETCH_MAX_POSTS,
      page_size: VIEW_FETCH_PAGE_SIZE,
      max_run_ms: VIEW_FETCH_MAX_RUN_MS,
      delay_ms: VIEW_FETCH_DELAY_MS,
      public_concurrency: PUBLIC_VIEW_CONCURRENCY,
      success_public: stats.publicViewsUpdated,
      success_mtproto: stats.mtprotoSuccesses,
      public_not_found: stats.publicNotFound,
      public_timeout: stats.publicTimeout,
      public_provider_error: stats.publicProviderErrors,
      mtproto_calls: stats.mtprotoCalls,
      mtproto_requests_attempted: stats.mtprotoRequestsAttempted,
      mtproto_successes: stats.mtprotoSuccesses,
      mtproto_actual_failures: stats.mtprotoActualFailures,
      mtproto_accounts_skipped_cooldown: stats.mtprotoAccountsSkippedCooldown,
      mtproto_rate_limited: stats.mtprotoRateLimited,
      mtproto_no_account_available: stats.mtprotoNoAccountAvailable,
      mtproto_peer_error: stats.mtprotoPeerErrors,
      mtproto_unavailable_until: earliestMtprotoRecoverySeconds
        ? new Date(Date.now() + earliestMtprotoRecoverySeconds * 1000).toISOString()
        : null,
      public_fallback_attempts: stats.publicFallbackAttempts,
      public_fallback_successes: stats.publicFallbackSuccesses,
      public_provider_unavailable_until: providerUnavailableUntil ? new Date(providerUnavailableUntil).toISOString() : null,
      billing_triggered: stats.billingTriggered,
      billing_no_delta: stats.billingNoDelta,
      billing_failed: stats.billingFailed,
      backlog: {
        overdue_1h: Number(backlog.overdue1h || 0),
        overdue_3h: Number(backlog.overdue3h || 0),
        overdue_6h: Number(backlog.overdue6h || 0),
        overdue_12h: Number(backlog.overdue12h || 0),
        overdue_24h: Number(backlog.overdue24h || 0),
      },
      shards: shardRows.map((row) => ({
        shard: Number(row.shard),
        eligible: Number(row.eligible || 0),
        due: Number(row.due || 0),
        processed: processedByShard.get(Number(row.shard)) || 0,
        deferred: Math.max(0, Number(row.due || 0) - (processedByShard.get(Number(row.shard)) || 0)),
        oldest_due_age_seconds: Number(row.oldestDueAgeSeconds || 0),
      })),
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
