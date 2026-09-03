/* eslint-disable @typescript-eslint/no-explicit-any -- mysql aggregate result tuples are not schema-generated */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

type Db = typeof pool | PoolConnection;
export const FRAUD_STALE_HOURS = 24;

async function tableExists(db: Db, table: string) {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? LIMIT 1",
    [table],
  );
  return rows.length > 0;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getFraudCoverageMetrics(db: Db = pool) {
  const [[row]] = await db.query<Array<RowDataPacket & Record<string, unknown>>>(`
    SELECT COUNT(*) eligible_channels,
      SUM(fraud_last_evaluated_at IS NOT NULL) evaluated_channels,
      SUM(fraud_last_evaluated_at IS NULL) never_evaluated_channels,
      SUM(fraud_last_evaluated_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${FRAUD_STALE_HOURS} HOUR)) stale_evaluations,
      TIMESTAMPDIFF(HOUR, MIN(fraud_last_evaluated_at), UTC_TIMESTAMP()) oldest_evaluation_age_hours
    FROM channels WHERE is_deleted=FALSE AND status IN ('active','paused')`);
  const eligible = numberValue(row?.eligible_channels);
  const evaluated = numberValue(row?.evaluated_channels);
  return {
    eligible_channels: eligible,
    evaluated_channels: evaluated,
    never_evaluated_channels: numberValue(row?.never_evaluated_channels),
    stale_evaluations: numberValue(row?.stale_evaluations),
    oldest_evaluation_age_hours: row?.oldest_evaluation_age_hours == null ? null : numberValue(row.oldest_evaluation_age_hours),
    coverage_percent: eligible > 0 ? Number(((evaluated / eligible) * 100).toFixed(2)) : 100,
  };
}

export type PublisherRiskAssessment = {
  publisher_id: number;
  score: number;
  state: "low" | "medium" | "high" | "critical";
  reasons: Array<{ code: string; severity: string; count?: number; detail: string }>;
  inputs: Record<string, number>;
};

export async function assessPublisherRisk(userId: number, db: Db = pool): Promise<PublisherRiskAssessment> {
  const telemetryAvailable = await tableExists(db, "channel_traffic_events");
  const telemetrySql = telemetryAvailable
    ? "(SELECT COUNT(*) FROM channel_traffic_events te JOIN channels tc ON tc.id=te.channel_id WHERE tc.user_id=u.id AND te.concentration_alert=1 AND te.created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 7 DAY))"
    : "0";
  const [[row]] = await db.query<Array<RowDataPacket & Record<string, unknown>>>(`
    SELECT u.id,u.publisher_trust_score,u.publisher_risk_score,
      (SELECT COUNT(*) FROM channels c WHERE c.user_id=u.id AND c.is_deleted=FALSE) channel_count,
      (SELECT COUNT(*) FROM channels c WHERE c.user_id=u.id AND c.is_deleted=FALSE AND c.fraud_last_evaluated_at IS NULL) never_scanned,
      (SELECT COUNT(*) FROM channels c WHERE c.user_id=u.id AND c.is_deleted=FALSE AND c.fraud_last_evaluated_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL ${FRAUD_STALE_HOURS} HOUR)) stale_scanned,
      (SELECT COALESCE(MAX(c.channel_fraud_risk_score),0) FROM channels c WHERE c.user_id=u.id AND c.is_deleted=FALSE) channel_risk,
      (SELECT COUNT(*) FROM referral_abuse_flags f WHERE f.referrer_id=u.id AND f.status='open' AND f.risk_level='critical') critical_referral_flags,
      (SELECT COUNT(*) FROM referral_abuse_flags f WHERE f.referrer_id=u.id AND f.status='open' AND f.risk_level='high') high_referral_flags,
      (SELECT COUNT(*) FROM referral_abuse_flags f WHERE f.referrer_id=u.id AND f.status='open' AND f.signal_key='mass_referral_creation') mass_referral_flags,
      (SELECT COUNT(*) FROM referral_abuse_flags f WHERE f.referrer_id=u.id AND f.status='open' AND f.signal_key IN ('same_ip_or_device_self_referral','shared_signal_cluster','referral_loop','duplicate_telegram_identity')) shared_identity_referral_flags,
      (SELECT COUNT(*) FROM referral_reward_ledger r WHERE r.user_id=u.id AND r.status NOT IN ('paid','reversed')) unresolved_referral_rewards,
      ${telemetrySql} telemetry_alerts
    FROM users u WHERE u.id=?`, [userId]);
  if (!row) throw new Error("publisher_not_found");
  const reasons: PublisherRiskAssessment["reasons"] = [];
  let score = Math.max(numberValue(row.publisher_risk_score), numberValue(row.channel_risk));
  const never = numberValue(row.never_scanned);
  const stale = numberValue(row.stale_scanned);
  const critical = numberValue(row.critical_referral_flags);
  const high = numberValue(row.high_referral_flags);
  const unresolvedRewards = numberValue(row.unresolved_referral_rewards);
  const massReferral = numberValue(row.mass_referral_flags);
  const sharedIdentity = numberValue(row.shared_identity_referral_flags);
  const alerts = numberValue(row.telemetry_alerts);
  if (never) { score += Math.min(20, never * 5); reasons.push({ code: "unscanned_channels", severity: "high", count: never, detail: "Publisher has channels awaiting their first fraud evaluation." }); }
  if (stale) { score += Math.min(15, stale * 3); reasons.push({ code: "stale_channel_evaluations", severity: "medium", count: stale, detail: "Publisher has stale channel fraud evaluations." }); }
  if (critical) { score += 35; reasons.push({ code: "critical_referral_flags", severity: "critical", count: critical, detail: "Unresolved critical referral abuse flags are open." }); }
  if (high) { score += Math.min(25, 5 + high); reasons.push({ code: "high_referral_flags", severity: "high", count: high, detail: "Unresolved high-risk referral abuse flags are open." }); }
  if (unresolvedRewards) { score += Math.min(15, unresolvedRewards * 2); reasons.push({ code: "unresolved_referral_rewards", severity: "medium", count: unresolvedRewards, detail: "Referral rewards are still pending or otherwise unresolved." }); }
  if (massReferral) { score += Math.min(25, 10 + massReferral * 3); reasons.push({ code: "mass_referral_creation", severity: "high", count: massReferral, detail: "Open mass-referral creation signals exist." }); }
  if (sharedIdentity) { score += Math.min(30, 12 + sharedIdentity * 3); reasons.push({ code: "shared_identity_referrals", severity: "high", count: sharedIdentity, detail: "Open same-network, device, loop, or duplicate-identity referral signals exist." }); }
  if (alerts) { score += Math.min(20, alerts * 2); reasons.push({ code: "traffic_concentration", severity: "high", count: alerts, detail: "Recent privacy-safe traffic concentration alerts exist." }); }
  const trust = numberValue(row.publisher_trust_score);
  if (trust <= 20) { score += 20; reasons.push({ code: "low_publisher_trust", severity: "high", detail: `Publisher trust is ${trust}.` }); }
  score = Math.min(100, Math.max(0, Math.round(score)));
  const state = score >= 80 ? "critical" : score >= 60 ? "high" : score >= 35 ? "medium" : "low";
  return { publisher_id: userId, score, state, reasons, inputs: { trust, channel_risk: numberValue(row.channel_risk), never_scanned: never, stale_scanned: stale, critical_referral_flags: critical, high_referral_flags: high, unresolved_referral_rewards: unresolvedRewards, mass_referral_flags: massReferral, shared_identity_referral_flags: sharedIdentity, telemetry_alerts: alerts } };
}

export async function persistPublisherRiskAssessment(userId: number, db: Db = pool) {
  const assessment = await assessPublisherRisk(userId, db);
  if (await tableExists(db, "publisher_risk_assessments")) {
    await db.query(`INSERT INTO publisher_risk_assessments
      (publisher_id,risk_score,risk_state,reasons,inputs,assessed_at)
      VALUES (?,?,?,?,?,UTC_TIMESTAMP())
      ON DUPLICATE KEY UPDATE risk_score=VALUES(risk_score),risk_state=VALUES(risk_state),reasons=VALUES(reasons),inputs=VALUES(inputs),assessed_at=VALUES(assessed_at)`,
      [userId, assessment.score, assessment.state, JSON.stringify(assessment.reasons), JSON.stringify(assessment.inputs)]);
  }
  return assessment;
}

export async function getLedgerCoverageMetrics(userId?: number, db: Db = pool) {
  const canonicalAvailable = await tableExists(db, "channel_allocation_ledger");
  const publisher = userId ? " AND publisher_id=?" : "";
  const [[canonicalRows]]: any = canonicalAvailable
    ? await db.query(`SELECT COUNT(*) count,MIN(occurred_at) cutover_at,
        SUM(fraud_status IN ('suspected','confirmed')) flagged_count,
        COALESCE(SUM(CASE WHEN fraud_status='clear' THEN publisher_allocation ELSE 0 END),0) cleared_publisher_amount
      FROM channel_allocation_ledger WHERE source_type IN ('click','view')${publisher}`, userId ? [userId] : [])
    : [[{ count: 0, cutover_at: null, flagged_count: 0, cleared_publisher_amount: 0 }]];
  const cutoverAt = canonicalRows?.cutover_at || null;
  const cutoffExpr = cutoverAt ? ",SUM(created_at>=?) post_cutover" : ",0 post_cutover";
  const legacyParams = cutoverAt ? [cutoverAt, ...(userId ? [userId] : [])] : userId ? [userId] : [];
  const [[[legacyClicks]], [[legacyViews]]]: any = await Promise.all([
    db.query(`SELECT COUNT(*) count${cutoffExpr} FROM ad_settlements WHERE 1=1${publisher}`, legacyParams),
    db.query(`SELECT COUNT(*) count${cutoffExpr} FROM ad_settlements_views WHERE 1=1${publisher}`, legacyParams),
  ]);
  const legacy = numberValue(legacyClicks?.count) + numberValue(legacyViews?.count);
  const canonical = numberValue(canonicalRows?.count);
  const postCutover = numberValue(legacyClicks?.post_cutover) + numberValue(legacyViews?.post_cutover);
  const legacyCutoverRecords = Math.max(0, legacy - postCutover);
  const missing = canonical > 0 ? Math.max(0, postCutover - canonical) : 0;
  return { legacy_settlement_records: legacy, canonical_ledger_records: canonical, legitimate_legacy_records: legacyCutoverRecords, post_cutover_settlement_records: postCutover, canonical_schema_available: canonicalAvailable, cutover_at: cutoverAt, coverage_gap_records: missing, flagged_canonical_records: numberValue(canonicalRows?.flagged_count), cleared_canonical_publisher_amount: numberValue(canonicalRows?.cleared_publisher_amount), classification: canonical === 0 ? "legacy_only" : missing > 0 ? "mixed_cutover" : "canonical_covered_since_cutover" };
}

export type WithdrawalPreclearance = { state: "cleared" | "manual_review_required"; reasons: string[]; reason_details: Array<{ code: string; detail: string }>; risk: PublisherRiskAssessment; ledger: Awaited<ReturnType<typeof getLedgerCoverageMetrics>> };

export async function assessWithdrawalPreclearance(withdrawalId: number, db: Db = pool): Promise<WithdrawalPreclearance> {
  const [[withdrawal]] = await db.query<Array<RowDataPacket & { user_id: number; amount: number | string; refunded: number | boolean; balance_locked: number | string; balance_available: number | string }>>(
    "SELECT w.user_id,w.amount,COALESCE(w.refunded,0) refunded,u.balance_locked,u.balance_available FROM withdrawals w JOIN users u ON u.id=w.user_id WHERE w.id=?", [withdrawalId]);
  if (!withdrawal) throw new Error("withdrawal_not_found");
  const [risk, ledger] = await Promise.all([assessPublisherRisk(Number(withdrawal.user_id), db), getLedgerCoverageMetrics(Number(withdrawal.user_id), db)]);
  const reasons: string[] = [];
  const details: WithdrawalPreclearance["reason_details"] = [];
  const amount = numberValue(withdrawal.amount);
  const balanceSource = Boolean(withdrawal.refunded) ? "available" : "locked";
  const payableBalance = balanceSource === "available" ? numberValue(withdrawal.balance_available) : numberValue(withdrawal.balance_locked);
  if (payableBalance < amount) { reasons.push("insufficient_cleared_earnings"); details.push({ code: "insufficient_cleared_earnings", detail: `${balanceSource} balance ${payableBalance.toFixed(8)} is below withdrawal amount ${amount.toFixed(8)}.` }); }
  if (risk.inputs.never_scanned > 0 || risk.inputs.stale_scanned > 0) { reasons.push("incomplete_fraud_coverage"); details.push({ code: "incomplete_fraud_coverage", detail: `${risk.inputs.never_scanned} never-scanned and ${risk.inputs.stale_scanned} stale channels.` }); }
  if (risk.inputs.critical_referral_flags > 0 || risk.inputs.high_referral_flags > 0 || risk.inputs.unresolved_referral_rewards > 0) { reasons.push("unresolved_referral_risk"); details.push({ code: "unresolved_referral_risk", detail: `${risk.inputs.critical_referral_flags} critical flags, ${risk.inputs.high_referral_flags} high-risk flags, and ${risk.inputs.unresolved_referral_rewards} unresolved referral rewards.` }); }
  if (risk.inputs.telemetry_alerts > 0) { reasons.push("traffic_quality_review"); details.push({ code: "traffic_quality_review", detail: `${risk.inputs.telemetry_alerts} recent concentration alerts.` }); }
  if (risk.state === "high" || risk.state === "critical") { reasons.push("publisher_risk_review"); details.push({ code: "publisher_risk_review", detail: `Publisher aggregate risk is ${risk.state} (${risk.score}).` }); }
  return { state: reasons.length ? "manual_review_required" : "cleared", reasons: [...new Set(reasons)], reason_details: details, risk, ledger };
}

export async function getAdminChannelSafetyMetrics(db: Db = pool) {
  const [fraud, ledger] = await Promise.all([getFraudCoverageMetrics(db), getLedgerCoverageMetrics(undefined, db)]);
  const hasGeo = await tableExists(db, "channel_geo_classifications");
  const hasTelemetry = await tableExists(db, "channel_traffic_events");
  const [[counts]]: any = await db.query(`SELECT
    (SELECT COUNT(DISTINCT referrer_id) FROM referral_abuse_flags WHERE status='open' AND risk_level IN ('high','critical')) high_risk_publishers,
    (SELECT COUNT(*) FROM referral_abuse_flags WHERE status='open' AND risk_level='critical') unresolved_critical_flags,
    (SELECT COUNT(*) FROM withdrawals w JOIN users u ON u.id=w.user_id WHERE w.status='pending' AND
      (COALESCE(u.publisher_risk_score,0)>=60 OR EXISTS (SELECT 1 FROM referral_abuse_flags f WHERE f.referrer_id=w.user_id AND f.status='open' AND f.risk_level IN ('high','critical')))) withdrawals_manual_review,
    (SELECT COUNT(*) FROM withdrawals w WHERE w.status='pending' AND EXISTS
      (SELECT 1 FROM channels c WHERE c.user_id=w.user_id AND c.is_deleted=FALSE AND
        (c.fraud_last_evaluated_at IS NULL OR c.fraud_last_evaluated_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL ${FRAUD_STALE_HOURS} HOUR)))) withdrawals_incomplete_coverage`);
  let geoConflicts = 0;
  let telemetryAlerts = 0;
  if (hasGeo) { const [[row]]: any = await db.query("SELECT COUNT(*) count FROM channel_geo_classifications WHERE conflict_detected=1 OR status='stale'"); geoConflicts = numberValue(row?.count); }
  if (hasTelemetry) { const [[row]]: any = await db.query("SELECT COUNT(*) count FROM channel_traffic_events WHERE concentration_alert=1 AND created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 7 DAY)"); telemetryAlerts = numberValue(row?.count); }
  return { ...fraud, geo_conflicts_or_stale: geoConflicts, high_risk_publishers: numberValue(counts?.high_risk_publishers), unresolved_critical_flags: numberValue(counts?.unresolved_critical_flags), withdrawals_requiring_manual_review: numberValue(counts?.withdrawals_manual_review), withdrawals_incomplete_fraud_coverage: numberValue(counts?.withdrawals_incomplete_coverage), telemetry_concentration_alerts: telemetryAlerts, ledger_coverage_gaps: ledger.coverage_gap_records, ledger_classification: ledger.classification };
}
