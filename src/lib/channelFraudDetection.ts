import crypto from "crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getPublisherQuality } from "@/lib/publisherQuality";
import { fraudBillingStateForSeverity } from "@/lib/channelFraudBilling";

export type FraudSeverity = "low" | "medium" | "high" | "critical";

type ChannelRow = RowDataPacket & {
  id: number;
  user_id: number;
  subscriber_count: number | string | null;
  traffic_quality_score: number | string | null;
  publisher_trust_score: number | string | null;
  channel_fraud_risk_score: number | string | null;
  fraud_clean_streak: number | string | null;
  trust_score_frozen_until: Date | string | null;
};

type PostSignalRow = RowDataPacket & {
  post_id: number;
  campaign_id: number | null;
  views: number | string;
  clicks: number | string;
};

type DailyPatternRow = RowDataPacket & {
  total_views: number | string;
  total_clicks: number | string;
  average_daily_views: number | string;
  maximum_daily_views: number | string;
  previous_average_views: number | string;
};

type ClickPatternRow = RowDataPacket & {
  duplicate_fingerprints: number | string;
  maximum_five_minute_clicks: number | string;
  fingerprint_missing: number | string;
  clicks: number | string;
};

type BehaviorRow = RowDataPacket & {
  deleted_channels: number | string;
  inaccessible_channels: number | string;
  permission_failures: number | string;
  fetch_failures: number | string;
  fetch_sources: number | string;
};

type FraudSignal = {
  fraudType: string;
  severity: FraudSeverity;
  reason: string;
  campaignId?: number | null;
  postId?: number | null;
  metadata?: Record<string, unknown>;
};

export type ChannelFraudDetectionResult = {
  evaluationBucket: string;
  channelsChecked: number;
  channelsSkipped: number;
  eventsCreated: number;
  publishersBanned: number;
  recoveredChannels: number;
};

const SEVERITY_POINTS: Record<FraudSeverity, number> = { low: 3, medium: 8, high: 18, critical: 30 };
const SEVERITY_ORDER: Record<FraudSeverity | "none", number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

function numberValue(input: unknown) {
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(input: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, input));
}

function rounded(input: number) {
  return Number(input.toFixed(4));
}

function evaluationBucket(now = new Date()) {
  const bucket = new Date(Math.floor(now.getTime() / 900_000) * 900_000);
  return bucket.toISOString().slice(0, 19).replace("T", " ");
}

function highestSeverity(signals: FraudSignal[]): FraudSeverity | "none" {
  return signals.reduce<FraudSeverity | "none">(
    (highest, signal) => SEVERITY_ORDER[signal.severity] > SEVERITY_ORDER[highest] ? signal.severity : highest,
    "none"
  );
}

function addPostSignals(signals: FraudSignal[], posts: PostSignalRow[], subscribers: number) {
  for (const row of posts) {
    const views = numberValue(row.views);
    const clicks = numberValue(row.clicks);
    const ctr = views > 0 ? clicks / views : 0;
    if (views >= 1_000 && clicks === 0) {
      signals.push({ fraudType: "zero_engagement_1000", severity: "high", postId: row.post_id, campaignId: row.campaign_id, reason: `${views} views produced zero clicks`, metadata: { views, clicks } });
    } else if (views >= 500 && clicks === 0) {
      signals.push({ fraudType: "zero_engagement_500", severity: "medium", postId: row.post_id, campaignId: row.campaign_id, reason: `${views} views produced zero clicks`, metadata: { views, clicks } });
    }
    if (views >= 100 && clicks > views) {
      signals.push({ fraudType: "clicks_above_views", severity: "critical", postId: row.post_id, campaignId: row.campaign_id, reason: `${clicks} clicks exceed ${views} views`, metadata: { views, clicks } });
    } else if (views >= 100 && ctr >= 0.2) {
      signals.push({ fraudType: "extreme_ctr", severity: ctr >= 0.5 ? "critical" : "high", postId: row.post_id, campaignId: row.campaign_id, reason: `CTR ${(ctr * 100).toFixed(2)}% is abnormally high`, metadata: { views, clicks, ctr } });
    } else if (views >= 1_000 && ctr < 0.0005) {
      signals.push({ fraudType: "near_zero_ctr", severity: "medium", postId: row.post_id, campaignId: row.campaign_id, reason: `CTR ${(ctr * 100).toFixed(4)}% is near zero at high volume`, metadata: { views, clicks, ctr } });
    }
    if (subscribers > 0 && views >= 500 && views > subscribers * 2) {
      signals.push({ fraudType: "views_above_subscribers", severity: views > subscribers * 5 ? "critical" : "high", postId: row.post_id, campaignId: row.campaign_id, reason: `${views} views greatly exceed ${subscribers} subscribers`, metadata: { views, subscribers } });
    }
  }
}

async function loadSignals(connection: PoolConnection, channel: ChannelRow): Promise<FraudSignal[]> {
  const [posts] = await connection.query<PostSignalRow[]>(
    `SELECT ps.post_id, ps.campaign_id, SUM(ps.views) AS views, SUM(ps.clicks) AS clicks
     FROM channel_post_daily_stats ps
     WHERE ps.channel_id=? AND ps.stat_date>=DATE_SUB(CURDATE(), INTERVAL 30 DAY)
     GROUP BY ps.post_id, ps.campaign_id
     HAVING views>=100 OR clicks>=20
     ORDER BY views DESC LIMIT 20`,
    [channel.id]
  );
  const [dailyRows] = await connection.query<DailyPatternRow[]>(
    `SELECT COALESCE(SUM(views),0) total_views, COALESCE(SUM(clicks),0) total_clicks,
       COALESCE(AVG(views),0) average_daily_views, COALESCE(MAX(views),0) maximum_daily_views,
       COALESCE(AVG(CASE WHEN stat_date<CURDATE() THEN views END),0) previous_average_views
     FROM channel_daily_stats WHERE channel_id=? AND stat_date>=DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
    [channel.id]
  );
  const [clickRows] = await connection.query<ClickPatternRow[]>(
    `SELECT
       COALESCE((SELECT COUNT(*) FROM (SELECT fingerprint FROM campaign_clicks cc JOIN campaign_posts cp ON cp.id=cc.post_id
         WHERE cp.channel_id=? AND cc.created_at>=DATE_SUB(NOW(),INTERVAL 7 DAY) AND fingerprint IS NOT NULL
         GROUP BY fingerprint HAVING COUNT(*)>1) repeated),0) duplicate_fingerprints,
       COALESCE((SELECT MAX(bucket_clicks) FROM (SELECT COUNT(*) bucket_clicks FROM campaign_clicks cc JOIN campaign_posts cp ON cp.id=cc.post_id
         WHERE cp.channel_id=? AND cc.created_at>=DATE_SUB(NOW(),INTERVAL 1 DAY)
         GROUP BY FLOOR(UNIX_TIMESTAMP(cc.created_at)/300)) bursts),0) maximum_five_minute_clicks,
       SUM(cc.fingerprint IS NULL OR cc.fingerprint='') fingerprint_missing, COUNT(cc.id) clicks
     FROM campaign_clicks cc JOIN campaign_posts cp ON cp.id=cc.post_id
     WHERE cp.channel_id=? AND cc.created_at>=DATE_SUB(NOW(),INTERVAL 7 DAY)`,
    [channel.id, channel.id, channel.id]
  );
  const [behaviorRows] = await connection.query<BehaviorRow[]>(
    `SELECT
       SUM(ch.is_deleted=1 OR ch.status='deleted') deleted_channels,
       SUM(ch.status IN ('paused','inaccessible')) inaccessible_channels,
       SUM(ch.failure_reason LIKE '%admin%' OR ch.failure_reason LIKE '%permission%') permission_failures,
       (SELECT COUNT(*) FROM campaign_posts cp WHERE cp.channel_id=? AND cp.view_fetch_status='failed' AND cp.last_views_update>=DATE_SUB(NOW(),INTERVAL 7 DAY)) fetch_failures,
       (SELECT COUNT(DISTINCT cp.view_fetch_source) FROM campaign_posts cp WHERE cp.channel_id=? AND cp.last_views_update>=DATE_SUB(NOW(),INTERVAL 7 DAY)) fetch_sources
     FROM channels ch WHERE ch.user_id=?`,
    [channel.id, channel.id, channel.user_id]
  );

  const signals: FraudSignal[] = [];
  addPostSignals(signals, posts, numberValue(channel.subscriber_count));
  const daily = dailyRows[0];
  const previousAverage = numberValue(daily?.previous_average_views);
  const maximumDaily = numberValue(daily?.maximum_daily_views);
  if (maximumDaily >= 500 && previousAverage > 0 && maximumDaily > previousAverage * 3) {
    signals.push({ fraudType: "abnormal_view_spike", severity: maximumDaily > previousAverage * 6 ? "critical" : "high", reason: `Daily views spiked to ${maximumDaily} versus ${previousAverage.toFixed(2)} baseline`, metadata: { maximum_daily_views: maximumDaily, baseline: previousAverage } });
  }
  const repeatedHighPosts = posts.filter((row) => numberValue(row.views) >= Math.max(1_000, numberValue(channel.subscriber_count) * 1.5)).length;
  if (repeatedHighPosts >= 3) signals.push({ fraudType: "repeated_unusually_high_views", severity: repeatedHighPosts >= 5 ? "critical" : "high", reason: `${repeatedHighPosts} posts repeatedly show unusually high views`, metadata: { posts: repeatedHighPosts } });

  const click = clickRows[0];
  if (numberValue(click?.duplicate_fingerprints) >= 3) signals.push({ fraudType: "repeated_click_fingerprint", severity: numberValue(click.duplicate_fingerprints) >= 10 ? "high" : "medium", reason: `${numberValue(click.duplicate_fingerprints)} repeated click fingerprints detected`, metadata: { repeated_fingerprints: numberValue(click.duplicate_fingerprints) } });
  if (numberValue(click?.maximum_five_minute_clicks) >= 20) signals.push({ fraudType: "click_burst", severity: numberValue(click.maximum_five_minute_clicks) >= 100 ? "critical" : "high", reason: `${numberValue(click.maximum_five_minute_clicks)} clicks occurred within five minutes`, metadata: { burst_clicks: numberValue(click.maximum_five_minute_clicks) } });
  const clickCount = numberValue(click?.clicks);
  if (clickCount >= 20 && numberValue(click?.fingerprint_missing) / clickCount > 0.8) signals.push({ fraudType: "low_quality_click_pattern", severity: "medium", reason: "More than 80% of tracked clicks lack a usable fingerprint", metadata: { clicks: clickCount, missing: numberValue(click?.fingerprint_missing) } });

  const behavior = behaviorRows[0];
  if (numberValue(behavior?.deleted_channels) >= 2) signals.push({ fraudType: "repeated_deleted_channels", severity: "medium", reason: `${numberValue(behavior.deleted_channels)} publisher channels were deleted`, metadata: { deleted_channels: numberValue(behavior.deleted_channels) } });
  if (numberValue(behavior?.inaccessible_channels) >= 2) signals.push({ fraudType: "repeated_inaccessible_channels", severity: "medium", reason: `${numberValue(behavior.inaccessible_channels)} publisher channels became inaccessible`, metadata: { inaccessible_channels: numberValue(behavior.inaccessible_channels) } });
  if (numberValue(behavior?.permission_failures) >= 2) signals.push({ fraudType: "repeated_permission_failures", severity: "low", reason: "Repeated bot administrator or permission failures detected", metadata: { permission_failures: numberValue(behavior.permission_failures) } });
  if (numberValue(behavior?.fetch_failures) >= 3) signals.push({ fraudType: "view_fetch_inconsistency", severity: numberValue(behavior.fetch_failures) >= 10 ? "high" : "medium", reason: `${numberValue(behavior.fetch_failures)} view fetch failures detected`, metadata: { fetch_failures: numberValue(behavior.fetch_failures), sources: numberValue(behavior.fetch_sources) } });
  if (numberValue(behavior?.fetch_sources) >= 3) signals.push({ fraudType: "view_source_inconsistency", severity: "low", reason: "Post views required several inconsistent fetch sources", metadata: { sources: numberValue(behavior.fetch_sources) } });
  return signals;
}

export async function runChannelFraudDetection(limit = 200): Promise<ChannelFraudDetectionResult> {
  const boundedLimit = Math.min(500, Math.max(1, Math.floor(limit || 200)));
  const bucket = evaluationBucket();
  const [channels] = await pool.query<ChannelRow[]>(
    `SELECT id,user_id,subscriber_count,traffic_quality_score,publisher_trust_score,channel_fraud_risk_score,fraud_clean_streak,trust_score_frozen_until
     FROM channels WHERE is_deleted=FALSE AND status IN ('active','paused') ORDER BY id ASC LIMIT ${boundedLimit}`
  );
  const affectedPublishers = new Set<number>();
  let channelsChecked = 0;
  let channelsSkipped = 0;
  let eventsCreated = 0;
  let recoveredChannels = 0;

  for (const channel of channels) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [insert] = await connection.query<ResultSetHeader>(
        `INSERT IGNORE INTO channel_fraud_evaluations
          (channel_id,publisher_id,evaluation_bucket,old_trust_score,new_trust_score,old_risk_score,new_risk_score)
         VALUES (?,?,?,?,?,?,?)`,
        [channel.id, channel.user_id, bucket, numberValue(channel.publisher_trust_score), numberValue(channel.publisher_trust_score), numberValue(channel.channel_fraud_risk_score), numberValue(channel.channel_fraud_risk_score)]
      );
      if (insert.affectedRows !== 1) {
        await connection.rollback();
        channelsSkipped++;
        continue;
      }
      const evaluationId = insert.insertId;
      const signals = await loadSignals(connection, channel);
      const oldTrust = clamp(numberValue(channel.publisher_trust_score ?? channel.traffic_quality_score ?? 60), -100, 100);
      const oldRisk = clamp(numberValue(channel.channel_fraud_risk_score), 0, 100);
      const impact = Math.min(40, signals.reduce((sum, signal) => sum + SEVERITY_POINTS[signal.severity], 0));
      const trustFrozen = Boolean(channel.trust_score_frozen_until && new Date(channel.trust_score_frozen_until).getTime() > Date.now());
      const newTrust = trustFrozen ? oldTrust : rounded(signals.length ? clamp(oldTrust - impact, -100, 100) : clamp(oldTrust + 2, -100, 100));
      const newRisk = rounded(signals.length ? clamp(oldRisk + impact, 0, 100) : clamp(oldRisk - 1.5, 0, 100));
      const qualityDelta = signals.length ? -Math.min(25, impact * 0.65) : 1;
      const newTrafficQuality = rounded(clamp(numberValue(channel.traffic_quality_score ?? 60) + qualityDelta, 0, 100));
      const severity = highestSeverity(signals);

      for (const signal of signals) {
        await connection.query(
          `INSERT INTO channel_fraud_events
            (evaluation_id,channel_id,publisher_id,campaign_id,post_id,fraud_type,severity,billing_state,
             old_trust_score,new_trust_score,old_risk_score,new_risk_score,reason,metadata)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [evaluationId, channel.id, channel.user_id, signal.campaignId || null, signal.postId || null,
            signal.fraudType, signal.severity, fraudBillingStateForSeverity(signal.severity), oldTrust, newTrust, oldRisk, newRisk,
            signal.reason, signal.metadata ? JSON.stringify(signal.metadata) : null]
        );
        console.warn("Channel fraud event", { channel_id: channel.id, publisher_id: channel.user_id, campaign_id: signal.campaignId || null, post_id: signal.postId || null, fraud_type: signal.fraudType, severity: signal.severity, old_trust_score: oldTrust, new_trust_score: newTrust, old_risk_score: oldRisk, new_risk_score: newRisk, reason: signal.reason });
      }

      await connection.query(
        `UPDATE channels SET publisher_trust_score=?,channel_fraud_risk_score=?,traffic_quality_score=?,
           traffic_risk_level=?,fraud_clean_streak=?,fraud_last_evaluated_at=NOW() WHERE id=?`,
        [newTrust, newRisk, newTrafficQuality, newRisk >= 80 ? "critical" : newRisk >= 60 ? "high" : newRisk >= 35 ? "medium" : "low",
          signals.length ? 0 : numberValue(channel.fraud_clean_streak) + 1, channel.id]
      );
      if (!signals.length) {
        recoveredChannels++;
      }
      await connection.query(
        `UPDATE channel_fraud_evaluations SET signal_count=?,highest_severity=?,new_trust_score=?,new_risk_score=?,completed_at=NOW() WHERE id=?`,
        [signals.length, severity, newTrust, newRisk, evaluationId]
      );
      await connection.commit();
      channelsChecked++;
      eventsCreated += signals.length;
      affectedPublishers.add(channel.user_id);
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      console.error("Channel fraud evaluation failed", { channel_id: channel.id, error: error instanceof Error ? error.message : "unknown_error", trace: crypto.randomUUID() });
    } finally {
      connection.release();
    }
  }

  for (const publisherId of affectedPublishers) {
    const [[scores]] = await pool.query<Array<RowDataPacket & { trust: number; risk: number }>>(
      "SELECT AVG(publisher_trust_score) trust,MAX(channel_fraud_risk_score) risk FROM channels WHERE user_id=? AND is_deleted=FALSE",
      [publisherId]
    );
    await pool.query("UPDATE users SET publisher_trust_score=?,publisher_risk_score=? WHERE id=?", [rounded(numberValue(scores?.trust)), rounded(numberValue(scores?.risk)), publisherId]);
    const [publisherChannels] = await pool.query<Array<RowDataPacket & { id: number }>>("SELECT id FROM channels WHERE user_id=? AND is_deleted=FALSE", [publisherId]);
    for (const publisherChannel of publisherChannels) await getPublisherQuality(publisherChannel.id);
  }

  return { evaluationBucket: bucket, channelsChecked, channelsSkipped, eventsCreated, publishersBanned: 0, recoveredChannels };
}
