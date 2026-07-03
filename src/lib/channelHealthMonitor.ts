import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { checkChannelHealth } from "@/lib/channelLifecycle";
import { createSystemLog } from "@/lib/systemLogs";

export type OperationalHealthStatus = "healthy" | "warning" | "critical" | "disabled";
type ChannelHealthRow = RowDataPacket & {
  id: number; status: string; is_deleted: number; chat_id: string | null; username: string | null;
  channel_type: "public" | "private"; tracking_account_member_status: string | null;
  publisher_trust_score: number | string; channel_fraud_risk_score: number | string;
  publisher_quality_index: number | string; traffic_quality_score: number | string;
  last_successful_post_at: Date | null; last_successful_view_fetch_at: Date | null;
  last_successful_settlement_at: Date | null; send_failures: number | string;
  active_posts: number | string; fetch_failures: number | string; session_failures: number | string;
  latest_view_success: Date | null; latest_settlement: Date | null;
  ledger_mismatches: number | string; negative_balance: number | string; critical_fraud_events: number | string;
  invalid_audits: number | string; total_audits: number | string;
};
type HealthIssue = { area: "posting" | "views" | "settlement" | "quality" | "access"; severity: "warning" | "critical"; code: string; message: string; fix: string };
export type ChannelHealthResult = { channel_id: number; status: OperationalHealthStatus; health_score: number; auto_paused: boolean; issues: HealthIssue[] };

const count = (value: unknown) => Math.max(0, Number(value || 0));
const stale = (value: unknown, hours: number) => !value || Date.now() - new Date(String(value)).getTime() > hours * 3_600_000;

function add(issues: HealthIssue[], area: HealthIssue["area"], severity: HealthIssue["severity"], code: string, message: string, fix: string) {
  issues.push({ area, severity, code, message, fix });
}

export async function runChannelHealthMonitor(limit = 200) {
  const startedAt = Date.now();
  const boundedLimit = Math.min(500, Math.max(1, Math.floor(limit || 200)));
  const [[setting]] = await pool.query<Array<RowDataPacket & { value: string }>>("SELECT value FROM settings WHERE `key`='channel_health_auto_pause_critical' LIMIT 1");
  const autoPauseCritical = String(setting?.value || "0") === "1";
  const [duplicateRows] = await pool.query<Array<RowDataPacket & { channel_id: number; duplicate_settlements: number | string }>>(
    `SELECT dp.channel_id,COUNT(*) duplicate_settlements
     FROM (
       SELECT settlement_type,post_id,settled_through
       FROM channel_settlement_ledger
       GROUP BY settlement_type,post_id,settled_through
       HAVING COUNT(*)>1
     ) duplicates
     JOIN campaign_posts dp ON dp.id=duplicates.post_id
     GROUP BY dp.channel_id`
  );
  const duplicateSettlementsByChannel = new Map(duplicateRows.map((row) => [Number(row.channel_id), count(row.duplicate_settlements)]));
  const globalLedgerHasDuplicates = duplicateRows.length > 0;
  const [channels] = await pool.query<ChannelHealthRow[]>(
    `SELECT ch.id,ch.status,ch.is_deleted,ch.chat_id,ch.username,ch.channel_type,ch.tracking_account_member_status,
       ch.publisher_trust_score,ch.channel_fraud_risk_score,ch.publisher_quality_index,ch.traffic_quality_score,
       ch.last_successful_post_at,ch.last_successful_view_fetch_at,ch.last_successful_settlement_at,
       (SELECT COUNT(*) FROM campaign_posts cp WHERE cp.channel_id=ch.id AND cp.delivery_failed_at>=DATE_SUB(NOW(),INTERVAL 24 HOUR)
         AND (cp.delivery_failure_reason LIKE '%telegram%' OR cp.status='delivery_failed')) send_failures,
       (SELECT COUNT(*) FROM campaign_posts cp WHERE cp.channel_id=ch.id AND cp.status='active' AND cp.deleted_at IS NULL) active_posts,
       (SELECT COUNT(*) FROM campaign_posts cp WHERE cp.channel_id=ch.id AND cp.view_fetch_status='failed' AND cp.last_views_update>=DATE_SUB(NOW(),INTERVAL 6 HOUR)) fetch_failures,
       (SELECT COUNT(*) FROM campaign_posts cp WHERE cp.channel_id=ch.id AND cp.view_fetch_status='failed' AND cp.last_views_update>=DATE_SUB(NOW(),INTERVAL 24 HOUR)
         AND (cp.view_fetch_error LIKE '%AUTH_KEY_DUPLICATED%' OR cp.view_fetch_error LIKE '%session%')) session_failures,
       (SELECT MAX(cp.last_views_update) FROM campaign_posts cp WHERE cp.channel_id=ch.id AND cp.view_fetch_status='success') latest_view_success,
       (SELECT MAX(sl.created_at) FROM channel_settlement_ledger sl WHERE sl.channel_id=ch.id) latest_settlement,
       (SELECT COUNT(*) FROM channel_settlement_ledger sl WHERE sl.channel_id=ch.id AND ABS(sl.advertiser_debit-sl.publisher_credit-sl.platform_revenue-sl.reserve_amount)>0.00000001) ledger_mismatches,
       (u.balance_locked<0 OR u.balance_available<0) negative_balance,
       (SELECT COUNT(*) FROM channel_fraud_events fe WHERE fe.channel_id=ch.id AND fe.severity='critical' AND fe.false_positive_at IS NULL AND fe.created_at>=DATE_SUB(NOW(),INTERVAL 7 DAY)) critical_fraud_events,
       (SELECT SUM(cva.status='invalid') FROM campaign_views_audit cva WHERE cva.channel_id=ch.id AND cva.check_time>=DATE_SUB(NOW(),INTERVAL 30 DAY)) invalid_audits,
       (SELECT COUNT(*) FROM campaign_views_audit cva WHERE cva.channel_id=ch.id AND cva.check_time>=DATE_SUB(NOW(),INTERVAL 30 DAY)) total_audits
     FROM channels ch JOIN users u ON u.id=ch.user_id ORDER BY ch.id ASC LIMIT ${boundedLimit}`
  );
  const results: ChannelHealthResult[] = [];
  for (const channel of channels) {
    const issues: HealthIssue[] = [];
    const scores = { posting: 20, views: 20, settlement: 20, quality: 20, access: 20 };
    const disabled = Boolean(channel.is_deleted) || ["deleted", "rejected"].includes(channel.status);
    if (!channel.chat_id) { scores.access -= 20; add(issues, "access", "critical", "missing_chat_id", "Channel chat ID is missing.", "Reconnect the channel and save a valid Telegram chat ID."); }
    if (channel.channel_type === "public" && !channel.username) { scores.access -= 8; add(issues, "access", "warning", "missing_username", "Public channel username is missing.", "Restore the public username or reconnect the channel."); }
    if (channel.channel_type === "private" && channel.tracking_account_member_status && channel.tracking_account_member_status !== "member") { scores.access -= 15; add(issues, "access", "critical", "private_tracking_not_member", "Private tracking account is not a channel member.", "Re-add the assigned MTProto tracking account to the private channel."); }

    if (!disabled && channel.chat_id) {
      const telegramHealth = await checkChannelHealth({ id: channel.id, chat_id: channel.chat_id });
      if (!telegramHealth.ok) {
        scores.access -= telegramHealth.permanent ? 20 : 8;
        add(issues, "access", telegramHealth.permanent ? "critical" : "warning", telegramHealth.status, telegramHealth.reason || "Telegram access check failed.", telegramHealth.suggestedFix || "Verify channel access and retry.");
      }
    }
    if (count(channel.send_failures) >= 3) { scores.posting -= 20; add(issues, "posting", "critical", "repeated_send_failures", "Repeated Telegram post delivery failures in 24 hours.", "Verify bot admin and posting permissions, then run a health check."); }
    else if (count(channel.send_failures) > 0) { scores.posting -= 8; add(issues, "posting", "warning", "recent_send_failure", "A recent Telegram post failed.", "Review the latest delivery error and bot permissions."); }
    if (count(channel.active_posts) > 0 && stale(channel.last_successful_post_at, 168)) { scores.posting -= 6; add(issues, "posting", "warning", "stale_post_success", "No successful channel post has been recorded recently.", "Run a posting health check and inspect campaign delivery logs."); }

    const viewSuccess = channel.latest_view_success || channel.last_successful_view_fetch_at;
    if (count(channel.active_posts) > 0 && stale(viewSuccess, 3)) { scores.views -= 12; add(issues, "views", "warning", "stale_view_fetch", "Active posts have not received a successful view refresh recently.", "Run a forced view refresh and inspect the public API or MTProto session."); }
    if (count(channel.fetch_failures) >= 3) { scores.views -= 10; add(issues, "views", "warning", "repeated_fetch_errors", "Repeated view-fetch errors occurred in six hours.", "Inspect recent fetch errors and verify the channel identifier."); }
    if (count(channel.session_failures) > 0) { scores.views -= 20; add(issues, "views", "critical", "mtproto_session_error", "Private view fetching has an MTProto authorization or duplicated-key error.", "Replace the affected MTProto session and confirm only one process uses it."); }

    if (count(duplicateSettlementsByChannel.get(channel.id)) > 0) { scores.settlement -= 20; add(issues, "settlement", "critical", "duplicate_settlement", "Duplicate settlement keys were detected.", "Stop settlement jobs and inspect ledger uniqueness before resuming."); }
    if (count(channel.ledger_mismatches) > 0) { scores.settlement -= 20; add(issues, "settlement", "critical", "ledger_mismatch", "Settlement accounting proof does not balance.", "Review advertiser debit, publisher credit, platform revenue, and reserve ledger fields."); }
    if (count(channel.negative_balance) > 0) { scores.settlement -= 20; add(issues, "settlement", "critical", "negative_publisher_balance", "Publisher has a negative available or locked balance.", "Freeze payouts and reconcile the publisher ledger."); }

    const trust = Number(channel.publisher_trust_score || 60); const risk = Number(channel.channel_fraud_risk_score || 0);
    const pqi = Number(channel.publisher_quality_index || channel.traffic_quality_score || 60);
    if (trust < 20) { scores.quality -= 12; add(issues, "quality", "critical", "dangerous_trust", "Publisher trust score is below 20.", "Continue fraud monitoring and review traffic evidence; do not ban from health monitoring."); }
    if (risk >= 80) { scores.quality -= 10; add(issues, "quality", "critical", "high_fraud_risk", "Channel fraud risk is critically high.", "Review recent fraud events and mark confirmed false positives."); }
    else if (risk >= 60) { scores.quality -= 6; add(issues, "quality", "warning", "elevated_fraud_risk", "Channel fraud risk is elevated.", "Monitor traffic and review recent fraud signals."); }
    if (pqi < 30) { scores.quality -= 8; add(issues, "quality", "warning", "low_pqi", "Publisher Quality Index is below 30.", "Improve authentic engagement and consistent delivery quality."); }
    if (count(channel.critical_fraud_events) > 0) { scores.quality -= 5; add(issues, "quality", "warning", "recent_critical_fraud", "Unresolved critical fraud events exist.", "Review recent fraud events in the Admin Channel Control Center."); }
    const invalidRatio = count(channel.total_audits) ? count(channel.invalid_audits) / count(channel.total_audits) : 0;
    if (invalidRatio >= 0.2 && count(channel.total_audits) >= 5) { scores.quality -= 8; add(issues, "quality", "warning", "invalid_view_ratio", "Invalid view audits exceed 20%.", "Review view sources and investigate inorganic traffic."); }

    for (const key of Object.keys(scores) as Array<keyof typeof scores>) scores[key] = Math.max(0, scores[key]);
    const score = disabled ? 0 : Object.values(scores).reduce((sum, value) => sum + value, 0);
    const critical = issues.some((issue) => issue.severity === "critical");
    const status: OperationalHealthStatus = disabled ? "disabled" : critical || score < 60 ? "critical" : score < 85 ? "warning" : "healthy";
    const autoPaused = status === "critical" && autoPauseCritical && channel.status === "active";
    const primary = issues[0];
    await pool.query(
      `UPDATE channels SET health_status=?,health_score=?,health_checked_at=NOW(),health_failure_reason=?,
       suggested_fix=?,health_details=?,last_successful_view_fetch_at=COALESCE(last_successful_view_fetch_at,?),
       last_successful_settlement_at=COALESCE(last_successful_settlement_at,?),
       status=IF(?,'paused',status),paused_reason=IF(?, 'Critical operational health',paused_reason),auto_paused_at=IF(?,NOW(),auto_paused_at)
       WHERE id=?`,
      [status, score, primary?.message || null, primary?.fix || null, JSON.stringify({ scores, issues }), channel.latest_view_success, channel.latest_settlement, autoPaused, autoPaused, autoPaused, channel.id]
    );
    await pool.query(
      `INSERT INTO channel_health_checks(channel_id,status,health_score,posting_score,view_fetch_score,settlement_score,quality_score,access_score,issues,suggested_fix,auto_paused)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [channel.id, status, score, scores.posting, scores.views, scores.settlement, scores.quality, scores.access, JSON.stringify(issues), primary?.fix || null, autoPaused]
    );
    results.push({ channel_id: channel.id, status, health_score: score, auto_paused: autoPaused, issues });
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const summary = { checked: results.length, healthy: results.filter((r) => r.status === "healthy").length, warning: results.filter((r) => r.status === "warning").length, critical: results.filter((r) => r.status === "critical").length, disabled: results.filter((r) => r.status === "disabled").length, auto_paused: results.filter((r) => r.auto_paused).length, global_ledger_duplicate_status: globalLedgerHasDuplicates ? "duplicates_detected" : "clean", failed_checks: results.reduce((total, result) => total + result.issues.length, 0), runtime_ms: Date.now() - startedAt };
  console.info("Channel health monitor summary", { channels_checked: summary.checked, global_ledger_duplicate_status: summary.global_ledger_duplicate_status, failed_checks: summary.failed_checks, runtime_ms: summary.runtime_ms });
  await createSystemLog({ logType: "channel_health", status: summary.critical ? "partial_failure" : "success", title: "Hourly channel health monitor", attemptedCount: summary.checked, successCount: summary.healthy + summary.warning, failedCount: summary.critical, skippedCount: summary.disabled, autoPausedCount: summary.auto_paused, metadata: summary });
  return { ...summary, auto_pause_critical: autoPauseCritical, channels: results };
}
