import pool from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram";

type SettingMap = Map<string, string>;

type AlertInput = {
  entityType: string;
  entityId?: number | null;
  metricKey: string;
  severity: string;
  title: string;
  details?: string;
  currentValue?: number;
  thresholdValue?: number;
  ruleKey?: string;
  actionTaken?: string | null;
  metadata?: Record<string, unknown>;
};

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function settingNumber(settings: SettingMap, key: string, fallback: number) {
  const value = toNumber(settings.get(key));
  return Number.isFinite(value) ? value : fallback;
}

function settingBool(settings: SettingMap, key: string, fallback = false) {
  const value = settings.get(key);
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export async function getRevenueProtectionSettings(): Promise<SettingMap> {
  const [rows]: any = await pool.query("SELECT `key`, value FROM revenue_protection_settings");
  return new Map<string, string>(rows.map((row: any) => [String(row.key), String(row.value)]));
}

export async function recordRevenueProtectionAudit(input: {
  actorType?: string;
  actorId?: number | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  ruleTriggered?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await pool.query(
    `INSERT INTO revenue_protection_audit_logs
      (actor_type, actor_id, action, entity_type, entity_id, rule_triggered, reason, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.actorType || "system",
      input.actorId || null,
      input.action,
      input.entityType,
      input.entityId || null,
      input.ruleTriggered || null,
      input.reason || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ]
  );
}

async function notifyAdmins(message: string) {
  const [[setting]]: any = await pool.query("SELECT value FROM settings WHERE `key` = 'admin_alert_telegram_ids' LIMIT 1");
  const ids = String(setting?.value || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  for (const id of ids) {
    try {
      await sendTelegramMessage(id, message);
    } catch {
      // Best-effort financial safety notification.
    }
  }
}

export async function createRevenueProtectionAlert(input: AlertInput) {
  const [existing]: any = await pool.query(
    `SELECT id FROM revenue_protection_alerts
     WHERE entity_type = ? AND COALESCE(entity_id, 0) = COALESCE(?, 0)
       AND metric_key = ? AND status = 'open'
     LIMIT 1`,
    [input.entityType, input.entityId || null, input.metricKey]
  );

  if (existing.length > 0) {
    await pool.query(
      `UPDATE revenue_protection_alerts
       SET severity = ?, title = ?, details = ?, current_value = ?, threshold_value = ?,
           rule_key = ?, action_taken = ?, metadata = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        input.severity,
        input.title,
        input.details || null,
        input.currentValue || 0,
        input.thresholdValue || 0,
        input.ruleKey || null,
        input.actionTaken || null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        existing[0].id,
      ]
    );
    return Number(existing[0].id);
  }

  const [result]: any = await pool.query(
    `INSERT INTO revenue_protection_alerts
      (entity_type, entity_id, metric_key, severity, title, details, current_value, threshold_value, rule_key, action_taken, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.entityType,
      input.entityId || null,
      input.metricKey,
      input.severity,
      input.title,
      input.details || null,
      input.currentValue || 0,
      input.thresholdValue || 0,
      input.ruleKey || null,
      input.actionTaken || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ]
  );

  if (["high", "critical"].includes(input.severity)) {
    await notifyAdmins(`Revenue Protection Alert\n\n${input.title}\n${input.details || ""}`);
  }

  return Number(result.insertId);
}

async function getFinancialTotals(start: Date, end: Date) {
  const params = [start, end];
  const [[classic]]: any = await pool.query(
    `SELECT
       COALESCE(SUM(advertiser_paid), 0) as spend,
       COALESCE(SUM(publisher_reward), 0) as publisher_earnings
     FROM (
       SELECT advertiser_paid, publisher_reward, created_at FROM ad_settlements
       UNION ALL
       SELECT advertiser_paid, publisher_reward, created_at FROM ad_settlements_views
     ) s
     WHERE s.created_at >= ? AND s.created_at < ?`,
    params
  );
  const [[miniapp]]: any = await pool.query(
    `SELECT
       COALESCE(SUM(cost), 0) as spend,
       COALESCE(SUM(publisher_revenue), 0) as publisher_earnings,
       COALESCE(SUM(ads_galaxy_revenue), 0) as platform_revenue,
       COALESCE(SUM(reserve_revenue), 0) as reserve_revenue
     FROM miniapp_internal_ad_impressions
     WHERE created_at >= ? AND created_at < ?`,
    params
  );
  const spend = toNumber(classic?.spend) + toNumber(miniapp?.spend);
  const publisherEarnings = toNumber(classic?.publisher_earnings) + toNumber(miniapp?.publisher_earnings);
  const reserveRevenue = toNumber(miniapp?.reserve_revenue);
  const platformRevenue = Math.max(spend - publisherEarnings - reserveRevenue, 0) + toNumber(miniapp?.platform_revenue);
  const netProfit = spend - publisherEarnings - reserveRevenue;
  return {
    campaign_spend: spend,
    advertiser_spend: spend,
    publisher_earnings: publisherEarnings,
    platform_revenue: platformRevenue,
    reserve_revenue: reserveRevenue,
    net_profit: netProfit,
    profit_margin: spend > 0 ? netProfit / spend : 0,
  };
}

export async function upsertRevenueSnapshot(periodType: "daily" | "weekly" | "monthly", periodStart: Date, periodEnd: Date) {
  const totals = await getFinancialTotals(periodStart, periodEnd);
  await pool.query(
    `INSERT INTO revenue_protection_snapshots
      (period_type, period_start, period_end, campaign_spend, advertiser_spend, publisher_earnings, platform_revenue, reserve_revenue, net_profit, profit_margin, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      campaign_spend = VALUES(campaign_spend),
      advertiser_spend = VALUES(advertiser_spend),
      publisher_earnings = VALUES(publisher_earnings),
      platform_revenue = VALUES(platform_revenue),
      reserve_revenue = VALUES(reserve_revenue),
      net_profit = VALUES(net_profit),
      profit_margin = VALUES(profit_margin),
      metadata = VALUES(metadata)`,
    [
      periodType,
      dateKey(periodStart),
      dateKey(periodEnd),
      totals.campaign_spend,
      totals.advertiser_spend,
      totals.publisher_earnings,
      totals.platform_revenue,
      totals.reserve_revenue,
      totals.net_profit,
      totals.profit_margin,
      JSON.stringify({ generated_at: new Date().toISOString() }),
    ]
  );
  return totals;
}

export async function refreshRevenueSnapshots() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 6);
  const monthStart = new Date(today);
  monthStart.setDate(1);

  const [daily, weekly, monthly] = await Promise.all([
    upsertRevenueSnapshot("daily", today, tomorrow),
    upsertRevenueSnapshot("weekly", weekStart, tomorrow),
    upsertRevenueSnapshot("monthly", monthStart, tomorrow),
  ]);

  return { daily, weekly, monthly };
}

export async function recordPayoutSafetyCheck(input: {
  settlementType: string;
  settlementId?: number | null;
  campaignId?: number | null;
  publisherId?: number | null;
  advertiserPaid: number;
  publisherShare: number;
  platformShare?: number;
  reserveShare?: number;
  expectedPublisherShare: number;
  expectedPlatformShare: number;
  expectedReserveShare: number;
  metadata?: Record<string, unknown>;
}) {
  const delta =
    Math.abs(input.publisherShare - input.expectedPublisherShare)
    + Math.abs((input.platformShare || 0) - input.expectedPlatformShare)
    + Math.abs((input.reserveShare || 0) - input.expectedReserveShare);
  const status = delta > 0.000001 ? "blocked" : "passed";
  const reason = status === "blocked" ? "Settlement split does not match configured revenue protection rules" : null;

  await pool.query(
    `INSERT INTO payout_safety_checks
      (settlement_type, settlement_id, campaign_id, publisher_id, advertiser_paid, publisher_share,
       platform_share, reserve_share, expected_publisher_share, expected_platform_share, expected_reserve_share,
       status, reason, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.settlementType,
      input.settlementId || null,
      input.campaignId || null,
      input.publisherId || null,
      input.advertiserPaid,
      input.publisherShare,
      input.platformShare || 0,
      input.reserveShare || 0,
      input.expectedPublisherShare,
      input.expectedPlatformShare,
      input.expectedReserveShare,
      status,
      reason,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ]
  );

  if (status === "blocked") {
    await createRevenueProtectionAlert({
      entityType: "settlement",
      entityId: input.settlementId || null,
      metricKey: "payout_split_mismatch",
      severity: "critical",
      title: "Payout safety mismatch detected",
      details: reason || undefined,
      currentValue: delta,
      thresholdValue: 0,
      ruleKey: "reserve_mismatch",
      metadata: input.metadata,
    });
  }

  return { status, reason };
}

async function updatePublisherRiskScores(settings: SettingMap) {
  const critical = settingNumber(settings, "publisher_critical_risk_score", 80);
  const [rows]: any = await pool.query(`
    SELECT
      u.id,
      COALESCE(AVG(inv.traffic_quality_score), 60) as avg_quality,
      COALESCE(SUM(inv.fraud_signal_count), 0) as fraud_signals,
      COALESCE(SUM(inv.abandoned), 0) as abandoned,
      COALESCE(SUM(inv.completed), 0) as completed,
      COALESCE(w.rejections, 0) as risk_history,
      COALESCE(u.total_referral_earnings, 0) as referral_earnings
    FROM users u
    LEFT JOIN (
      SELECT user_id, traffic_quality_score, 0 as fraud_signal_count, 0 as abandoned, 0 as completed FROM channels WHERE is_deleted = 0
      UNION ALL
      SELECT user_id, traffic_quality_score, 0, 0, 0 FROM bots WHERE is_deleted = 0
      UNION ALL
      SELECT user_id, traffic_quality_score, 0, 0, 0 FROM miniapps WHERE is_deleted = 0
      UNION ALL
      SELECT ma.user_id, 60, i.fraud_signal_count,
        CASE WHEN i.completion_status IN ('abandoned', 'short_watch') THEN 1 ELSE 0 END,
        CASE WHEN i.completion_status IN ('completed', 'rewarded') THEN 1 ELSE 0 END
      FROM miniapp_internal_ad_impressions i
      JOIN miniapps ma ON ma.id = i.miniapp_id
      WHERE i.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    ) inv ON inv.user_id = u.id
    LEFT JOIN (
      SELECT user_id, COUNT(*) as rejections FROM withdrawals WHERE status = 'rejected' GROUP BY user_id
    ) w ON w.user_id = u.id
    GROUP BY u.id, w.rejections, u.total_referral_earnings
    HAVING avg_quality IS NOT NULL
  `);

  let criticalCount = 0;
  for (const row of rows) {
    const qualityRisk = clamp(100 - toNumber(row.avg_quality), 0, 100) * 0.45;
    const fraudRisk = clamp(toNumber(row.fraud_signals) * 3, 0, 30);
    const completions = toNumber(row.completed);
    const abandonmentRate = completions + toNumber(row.abandoned) > 0 ? toNumber(row.abandoned) / (completions + toNumber(row.abandoned)) : 0;
    const abandonmentRisk = clamp(abandonmentRate * 25, 0, 25);
    const historyRisk = clamp(toNumber(row.risk_history) * 8, 0, 20);
    const referralRisk = toNumber(row.referral_earnings) > 100 ? 10 : 0;
    const score = Math.round(clamp(qualityRisk + fraudRisk + abandonmentRisk + historyRisk + referralRisk, 0, 100));
    await pool.query("UPDATE users SET publisher_risk_score = ? WHERE id = ?", [score, row.id]);
    if (score >= critical) {
      criticalCount += 1;
      await createRevenueProtectionAlert({
        entityType: "publisher",
        entityId: Number(row.id),
        metricKey: "publisher_risk_score",
        severity: "critical",
        title: "Critical publisher risk score",
        details: `Publisher #${row.id} risk score is ${score}.`,
        currentValue: score,
        thresholdValue: critical,
        ruleKey: "critical_publisher_risk",
      });
    }
  }
  return { scored: rows.length, critical: criticalCount };
}

async function updateAdvertiserRiskScores(settings: SettingMap) {
  const critical = settingNumber(settings, "advertiser_critical_risk_score", 80);
  const [rows]: any = await pool.query(`
    SELECT
      u.id,
      COALESCE(u.advertiser_trust_level, 'new') as trust_level,
      COALESCE(w.warning_count, 0) as warning_count,
      COALESCE(c.rejected_campaigns, 0) as rejected_campaigns,
      COALESCE(c.total_campaigns, 0) as total_campaigns,
      COALESCE(d.watchlist_domains, 0) as watchlist_domains,
      COALESCE(d.blocked_domains, 0) as blocked_domains
    FROM users u
    LEFT JOIN (
      SELECT user_id, COUNT(*) as warning_count FROM user_moderation_warnings GROUP BY user_id
    ) w ON w.user_id = u.id
    LEFT JOIN (
      SELECT user_id, COUNT(*) as total_campaigns, SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_campaigns
      FROM campaigns GROUP BY user_id
    ) c ON c.user_id = u.id
    LEFT JOIN (
      SELECT 0 as user_id, 0 as watchlist_domains, 0 as blocked_domains
    ) d ON d.user_id = u.id
  `);

  let criticalCount = 0;
  for (const row of rows) {
    const rejectionRate = toNumber(row.total_campaigns) > 0 ? toNumber(row.rejected_campaigns) / toNumber(row.total_campaigns) : 0;
    const trustRisk = row.trust_level === "restricted" ? 35 : row.trust_level === "new" ? 12 : row.trust_level === "premium" ? -8 : 0;
    const score = Math.round(clamp(trustRisk + toNumber(row.warning_count) * 15 + rejectionRate * 35 + toNumber(row.blocked_domains) * 25 + toNumber(row.watchlist_domains) * 10, 0, 100));
    await pool.query("UPDATE users SET advertiser_risk_score = ? WHERE id = ?", [score, row.id]);
    if (score >= critical) {
      criticalCount += 1;
      await createRevenueProtectionAlert({
        entityType: "advertiser",
        entityId: Number(row.id),
        metricKey: "advertiser_risk_score",
        severity: "critical",
        title: "Critical advertiser risk score",
        details: `Advertiser #${row.id} risk score is ${score}.`,
        currentValue: score,
        thresholdValue: critical,
        ruleKey: "critical_advertiser_risk",
      });
    }
  }
  return { scored: rows.length, critical: criticalCount };
}

async function detectCampaignBurn(settings: SettingMap, autoPause: boolean) {
  const budgetAlert = settingNumber(settings, "campaign_budget_alert_percent", 80);
  const emergency = settingBool(settings, "emergency_protection_mode");
  const [rows]: any = await pool.query(`
    SELECT
      c.id,
      c.name,
      c.status,
      c.budget as remaining_budget,
      COALESCE(sp.spend, 0) as spend,
      COALESCE(sp.publisher_earnings, 0) as publisher_earnings
    FROM campaigns c
    LEFT JOIN (
      SELECT campaign_id, SUM(advertiser_paid) as spend, SUM(publisher_reward) as publisher_earnings
      FROM (
        SELECT campaign_id, advertiser_paid, publisher_reward FROM ad_settlements
        UNION ALL
        SELECT campaign_id, advertiser_paid, publisher_reward FROM ad_settlements_views
      ) x GROUP BY campaign_id
    ) sp ON sp.campaign_id = c.id
    WHERE c.status IN ('active', 'paused', 'budget_exhausted')
    ORDER BY spend DESC
    LIMIT 200
  `);

  let alerts = 0;
  let paused = 0;
  for (const row of rows) {
    const spend = toNumber(row.spend);
    const remaining = toNumber(row.remaining_budget);
    const total = spend + remaining;
    const consumed = total > 0 ? (spend / total) * 100 : 0;
    if (consumed >= budgetAlert) {
      alerts += 1;
      const critical = consumed >= 100;
      let actionTaken: string | null = null;
      if (critical && emergency && autoPause && row.status === "active") {
        await pool.query(
          "UPDATE campaigns SET status = 'paused', revenue_protection_status = 'paused', revenue_protection_reason = ?, revenue_protection_paused_at = NOW(), pause_reason = ? WHERE id = ?",
          ["Budget protection threshold reached", "revenue_protection", row.id]
        );
        actionTaken = "paused";
        paused += 1;
      }
      await createRevenueProtectionAlert({
        entityType: "campaign",
        entityId: Number(row.id),
        metricKey: "budget_consumed_percent",
        severity: critical ? "critical" : "high",
        title: "Campaign budget protection alert",
        details: `${row.name || "Campaign"} consumed ${consumed.toFixed(1)}% of tracked budget.`,
        currentValue: consumed,
        thresholdValue: budgetAlert,
        ruleKey: critical ? "budget_100_consumed" : "budget_80_consumed",
        actionTaken,
      });
    }
  }
  return { scanned: rows.length, alerts, paused };
}

async function detectTrafficAnomalies(settings: SettingMap) {
  const multiplier = settingNumber(settings, "traffic_spike_multiplier", 3);
  const [[today]]: any = await pool.query(`
    SELECT
      COALESCE((SELECT COUNT(*) FROM campaign_clicks WHERE created_at >= CURDATE()), 0) as clicks,
      COALESCE((SELECT SUM(views) FROM campaign_posts WHERE DATE(created_at) = CURDATE()), 0) as views,
      COALESCE((SELECT COUNT(*) FROM ad_conversions WHERE created_at >= CURDATE()), 0) as conversions,
      COALESCE((SELECT COUNT(*) FROM referrals WHERE created_at >= CURDATE()), 0) as referrals,
      COALESCE((SELECT SUM(cost) FROM miniapp_internal_ad_impressions WHERE created_at >= CURDATE()), 0) as revenue
  `);
  const [[average]]: any = await pool.query(`
    SELECT
      COALESCE((SELECT COUNT(*) / 7 FROM campaign_clicks WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND created_at < CURDATE()), 0) as clicks,
      COALESCE((SELECT SUM(views) / 7 FROM campaign_posts WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND created_at < CURDATE()), 0) as views,
      COALESCE((SELECT COUNT(*) / 7 FROM ad_conversions WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND created_at < CURDATE()), 0) as conversions,
      COALESCE((SELECT COUNT(*) / 7 FROM referrals WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND created_at < CURDATE()), 0) as referrals,
      COALESCE((SELECT SUM(cost) / 7 FROM miniapp_internal_ad_impressions WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND created_at < CURDATE()), 0) as revenue
  `);
  let alerts = 0;
  for (const metric of ["clicks", "views", "conversions", "referrals", "revenue"]) {
    const baseline = Math.max(toNumber(average?.[metric]), 1);
    const current = toNumber(today?.[metric]);
    if (current >= baseline * multiplier && current > 0) {
      alerts += 1;
      await createRevenueProtectionAlert({
        entityType: "platform",
        metricKey: `${metric}_spike`,
        severity: metric === "revenue" ? "critical" : "high",
        title: `${metric} spike detected`,
        details: `${metric} reached ${current.toFixed(2)} versus a 7-day daily average of ${baseline.toFixed(2)}.`,
        currentValue: current,
        thresholdValue: baseline * multiplier,
        ruleKey: "traffic_anomaly",
        metadata: { multiplier },
      });
    }
  }
  return { alerts };
}

export async function runRevenueProtectionScan(options: { autoPause?: boolean; actorId?: number | null } = {}) {
  const settings = await getRevenueProtectionSettings();
  const enabled = settingBool(settings, "revenue_protection_enabled", true);
  if (!enabled) return { skipped: true, reason: "Revenue protection disabled" };

  const snapshots = await refreshRevenueSnapshots();
  const [publisherRisk, advertiserRisk, campaignBurn, traffic] = await Promise.all([
    updatePublisherRiskScores(settings),
    updateAdvertiserRiskScores(settings),
    detectCampaignBurn(settings, Boolean(options.autoPause)),
    detectTrafficAnomalies(settings),
  ]);

  await recordRevenueProtectionAudit({
    actorType: options.actorId ? "admin" : "system",
    actorId: options.actorId || null,
    action: "revenue_protection_scan",
    entityType: "platform",
    reason: "Financial safety scan completed",
    metadata: { snapshots, publisherRisk, advertiserRisk, campaignBurn, traffic },
  });

  return { snapshots, publisherRisk, advertiserRisk, campaignBurn, traffic };
}

export async function applyRevenueProtectionOverride(input: {
  action: string;
  entityType: string;
  entityId: number;
  reason: string;
  adminId?: number | null;
}) {
  const reason = input.reason || "Revenue protection override";

  if (input.action === "force_pause") {
    if (input.entityType === "campaign") {
      await pool.query(
        "UPDATE campaigns SET status = 'paused', revenue_protection_status = 'paused', revenue_protection_reason = ?, revenue_protection_paused_at = NOW(), pause_reason = ? WHERE id = ?",
        [reason, "revenue_protection", input.entityId]
      );
    } else if (input.entityType === "miniapp_rewarded") {
      await pool.query(
        "UPDATE miniapp_rewarded_campaigns SET status = 'paused', revenue_protection_status = 'paused', revenue_protection_reason = ?, revenue_protection_paused_at = NOW() WHERE id = ?",
        [reason, input.entityId]
      );
    } else if (input.entityType === "publisher" || input.entityType === "advertiser" || input.entityType === "user") {
      await pool.query("UPDATE users SET revenue_protection_status = 'paused' WHERE id = ?", [input.entityId]);
    } else if (["channel", "bot", "miniapp"].includes(input.entityType)) {
      await pool.query(`UPDATE ${input.entityType === "miniapp" ? "miniapps" : `${input.entityType}s`} SET revenue_protection_status = 'paused' WHERE id = ?`, [input.entityId]);
    }
  }

  if (input.action === "force_resume") {
    if (input.entityType === "campaign") {
      await pool.query(
        "UPDATE campaigns SET status = 'active', revenue_protection_status = 'normal', revenue_protection_reason = NULL, revenue_protection_paused_at = NULL, pause_reason = NULL WHERE id = ? AND budget > 0",
        [input.entityId]
      );
    } else if (input.entityType === "miniapp_rewarded") {
      await pool.query(
        "UPDATE miniapp_rewarded_campaigns SET status = 'approved', revenue_protection_status = 'normal', revenue_protection_reason = NULL, revenue_protection_paused_at = NULL WHERE id = ? AND remaining_budget > 0",
        [input.entityId]
      );
    } else if (input.entityType === "publisher" || input.entityType === "advertiser" || input.entityType === "user") {
      await pool.query("UPDATE users SET revenue_protection_status = 'normal' WHERE id = ?", [input.entityId]);
    } else if (["channel", "bot", "miniapp"].includes(input.entityType)) {
      await pool.query(`UPDATE ${input.entityType === "miniapp" ? "miniapps" : `${input.entityType}s`} SET revenue_protection_status = 'normal' WHERE id = ?`, [input.entityId]);
    }
  }

  if (input.action === "ignore_alert" || input.action === "mark_safe") {
    await pool.query(
      `UPDATE revenue_protection_alerts
       SET status = ?, ignored_at = CASE WHEN ? = 'ignore_alert' THEN NOW() ELSE ignored_at END,
           marked_safe_at = CASE WHEN ? = 'mark_safe' THEN NOW() ELSE marked_safe_at END,
           resolved_at = NOW()
       WHERE id = ?`,
      [input.action === "mark_safe" ? "safe" : "ignored", input.action, input.action, input.entityId]
    );
  } else {
    await pool.query(
      "INSERT INTO financial_safety_overrides (entity_type, entity_id, override_type, reason, created_by) VALUES (?, ?, ?, ?, ?)",
      [input.entityType, input.entityId, input.action, reason, input.adminId || null]
    );
  }

  await recordRevenueProtectionAudit({
    actorType: "admin",
    actorId: input.adminId || null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    reason,
  });
}
