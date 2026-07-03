import { NextResponse } from "next/server";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import {
  applyRevenueProtectionOverride,
  recordRevenueProtectionAudit,
  runRevenueProtectionScan,
} from "@/lib/revenueProtection";

function clean(value: unknown) {
  return String(value || "").trim();
}

function toNumber(value: unknown) {
  return Number.parseFloat(String(value ?? 0)) || 0;
}

function toPositiveInt(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

async function getRows(query: string, params: unknown[] = []) {
  const [rows]: any = await pool.query(query, params);
  return rows;
}

type RevenueReviewRow = RowDataPacket & {
  id: number;
  miniapp_id: number;
  miniapp_name: string;
  publisher_id: number;
  date: string;
  impressions: string | number;
  gross_revenue: string | number;
  publisher_revenue: string | number;
  ads_galaxy_fee: string | number;
  revenue_validation_reason: string | null;
  revenue_validation_status: string;
  revenue_review_status: string;
  revenue_review_note?: string | null;
  revenue_review_notes?: string | null;
  revenue_reviewed_by?: number | null;
  revenue_reviewed_at?: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
  settlement_id?: number | null;
};

function reviewListWhere(input: Record<string, unknown>) {
  const filters = ["ds.revenue_validation_status = 'suspicious'"];
  const params: unknown[] = [];
  const status = clean(input.status || input.review_status);
  const miniappId = toPositiveInt(input.miniapp_id);
  const publisherId = toPositiveInt(input.publisher_id);
  const date = clean(input.date);

  if (status) {
    filters.push("ds.revenue_review_status = ?");
    params.push(status);
  }
  if (miniappId) {
    filters.push("ds.miniapp_id = ?");
    params.push(miniappId);
  }
  if (publisherId) {
    filters.push("m.user_id = ?");
    params.push(publisherId);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    filters.push("ds.date = ?");
    params.push(date);
  }

  return { where: filters.join(" AND "), params };
}

async function listSuspiciousRevenueReviews(input: Record<string, unknown> = {}) {
  const limit = Math.min(200, Math.max(1, toPositiveInt(input.limit) || 100));
  const { where, params } = reviewListWhere(input);
  return getRows(`
    SELECT
      ds.id,
      ds.miniapp_id,
      m.miniapp_name,
      m.user_id as publisher_id,
      ds.date,
      ds.impressions,
      ds.gross_revenue,
      ds.publisher_revenue,
      ds.ads_galaxy_fee,
      ds.revenue_validation_reason,
      ds.revenue_validation_status,
      ds.revenue_review_status,
      COALESCE(ds.revenue_review_note, ds.revenue_review_notes) as revenue_review_note,
      ds.revenue_reviewed_by,
      ds.revenue_reviewed_at,
      ds.created_at,
      ds.updated_at,
      s.id as settlement_id
    FROM miniapp_daily_stats ds
    JOIN miniapps m ON m.id = ds.miniapp_id
    LEFT JOIN miniapp_earnings_settlements s ON s.daily_stat_id = ds.id
    WHERE ${where}
    ORDER BY ds.updated_at DESC, ds.id DESC
    LIMIT ?
  `, [...params, limit]);
}

async function reviewSuspiciousRevenue(input: {
  conn: PoolConnection;
  adminId: number;
  statId: number;
  status: "approved" | "rejected";
  note: string;
}) {
  const [rows] = await input.conn.query<RevenueReviewRow[]>(`
    SELECT
      ds.id,
      ds.miniapp_id,
      m.miniapp_name,
      m.user_id as publisher_id,
      ds.date,
      ds.impressions,
      ds.gross_revenue,
      ds.publisher_revenue,
      ds.ads_galaxy_fee,
      ds.revenue_validation_reason,
      ds.revenue_validation_status,
      ds.revenue_review_status,
      COALESCE(ds.revenue_review_note, ds.revenue_review_notes) as revenue_review_note,
      ds.created_at,
      ds.updated_at,
      s.id as settlement_id
    FROM miniapp_daily_stats ds
    JOIN miniapps m ON m.id = ds.miniapp_id
    LEFT JOIN miniapp_earnings_settlements s ON s.daily_stat_id = ds.id
    WHERE ds.id = ?
    FOR UPDATE
  `, [input.statId]);

  const stat = rows[0];
  if (!stat) {
    throw Object.assign(new Error("Suspicious revenue record not found"), { statusCode: 404 });
  }
  if (stat.revenue_validation_status !== "suspicious") {
    throw Object.assign(new Error("Only suspicious revenue records can be reviewed"), { statusCode: 400 });
  }
  if (stat.settlement_id) {
    throw Object.assign(new Error("Already-settled revenue records cannot be reviewed"), { statusCode: 409 });
  }
  if (stat.revenue_review_status === "approved" || stat.revenue_review_status === "rejected") {
    throw Object.assign(new Error("Revenue record has already been reviewed"), { statusCode: 409 });
  }

  await input.conn.query(
    `UPDATE miniapp_daily_stats
     SET revenue_review_status = ?,
         revenue_review_note = ?,
         revenue_review_notes = ?,
         revenue_reviewed_by = ?,
         revenue_reviewed_at = NOW()
     WHERE id = ?
       AND revenue_validation_status = 'suspicious'
       AND revenue_review_status = 'pending_review'`,
    [input.status, input.note || null, input.note || null, input.adminId, input.statId]
  );

  return stat;
}

export async function GET() {
  const { response } = await requireAdminPermission("read");
  if (response) return response;

  try {
    const [
      settings,
      rules,
      alerts,
      audits,
      snapshots,
      payoutChecks,
      topCampaigns,
      topCategories,
      topInventory,
      topCountries,
      publisherRisk,
      advertiserRisk,
      pendingRevenueReviews,
      approvedRevenueReviews,
      rejectedRevenueReviews,
    ] = await Promise.all([
      getRows("SELECT `key`, value, description FROM revenue_protection_settings ORDER BY `key`"),
      getRows("SELECT * FROM revenue_protection_rules ORDER BY active DESC, severity DESC, rule_type, rule_key"),
      getRows("SELECT * FROM revenue_protection_alerts WHERE status = 'open' ORDER BY FIELD(severity, 'critical', 'high', 'medium', 'low'), created_at DESC LIMIT 100"),
      getRows("SELECT * FROM revenue_protection_audit_logs ORDER BY created_at DESC LIMIT 100"),
      getRows("SELECT * FROM revenue_protection_snapshots ORDER BY period_start DESC, FIELD(period_type, 'daily', 'weekly', 'monthly') LIMIT 30"),
      getRows("SELECT * FROM payout_safety_checks ORDER BY created_at DESC LIMIT 50"),
      getRows(`
        SELECT c.id, c.name, c.category,
          COALESCE(sp.spend, 0) as spend,
          COALESCE(sp.publisher_earnings, 0) as publisher_earnings,
          COALESCE(sp.reserve_revenue, 0) as reserve_revenue,
          COALESCE(sp.spend, 0) - COALESCE(sp.publisher_earnings, 0) - COALESCE(sp.reserve_revenue, 0) as net_profit
        FROM campaigns c
        LEFT JOIN (
          SELECT campaign_id, SUM(advertiser_debit) as spend,
            SUM(publisher_distribution) as publisher_earnings, SUM(reserve_amount) as reserve_revenue
          FROM channel_settlement_ledger GROUP BY campaign_id
        ) sp ON sp.campaign_id = c.id
        ORDER BY net_profit DESC
        LIMIT 10
      `),
      getRows(`
        SELECT COALESCE(c.category, 'Uncategorized') as category,
          SUM(x.advertiser_debit) as spend,
          SUM(x.publisher_distribution) as publisher_earnings,
          SUM(x.platform_revenue) as net_profit
        FROM channel_settlement_ledger x
        JOIN campaigns c ON c.id = x.campaign_id
        GROUP BY COALESCE(c.category, 'Uncategorized')
        ORDER BY net_profit DESC
        LIMIT 10
      `),
      getRows(`
        SELECT inventory_type, inventory_id, SUM(spend) as spend, SUM(publisher_earnings) as publisher_earnings,
          SUM(spend - publisher_earnings - reserve_revenue) as net_profit
        FROM (
          SELECT 'channel' as inventory_type, channel_id as inventory_id,
            advertiser_debit as spend, publisher_distribution as publisher_earnings, reserve_amount as reserve_revenue
          FROM channel_settlement_ledger
          UNION ALL
          SELECT 'miniapp', miniapp_id, cost, publisher_revenue, reserve_revenue FROM miniapp_internal_ad_impressions
        ) x
        GROUP BY inventory_type, inventory_id
        ORDER BY net_profit DESC
        LIMIT 10
      `),
      getRows(`
        SELECT COALESCE(country, 'unknown') as country,
          SUM(cost) as spend,
          SUM(publisher_revenue) as publisher_earnings,
          SUM(cost - publisher_revenue - reserve_revenue) as net_profit
        FROM miniapp_internal_ad_impressions
        GROUP BY COALESCE(country, 'unknown')
        ORDER BY net_profit DESC
        LIMIT 10
      `),
      getRows("SELECT id, username, first_name, last_name, publisher_risk_score, revenue_protection_status FROM users WHERE publisher_risk_score > 0 ORDER BY publisher_risk_score DESC LIMIT 25"),
      getRows("SELECT id, username, first_name, last_name, advertiser_risk_score, revenue_protection_status FROM users WHERE advertiser_risk_score > 0 ORDER BY advertiser_risk_score DESC LIMIT 25"),
      listSuspiciousRevenueReviews({ status: "pending_review", limit: 100 }),
      listSuspiciousRevenueReviews({ status: "approved", limit: 50 }),
      listSuspiciousRevenueReviews({ status: "rejected", limit: 50 }),
    ]);

    const latest = snapshots[0] || {};
    const financials = {
      total_revenue: toNumber(latest.campaign_spend),
      total_publisher_earnings: toNumber(latest.publisher_earnings),
      total_reserve: toNumber(latest.reserve_revenue),
      net_profit: toNumber(latest.net_profit),
      profit_margin: toNumber(latest.profit_margin),
    };

    return NextResponse.json({
      settings,
      rules,
      alerts,
      audits,
      snapshots,
      payout_checks: payoutChecks,
      financials,
      profitability: {
        campaigns: topCampaigns,
        categories: topCategories,
        inventory: topInventory,
        countries: topCountries,
      },
      risk_scores: {
        publishers: publisherRisk,
        advertisers: advertiserRisk,
      },
      revenue_reviews: {
        pending: pendingRevenueReviews,
        approved: approvedRevenueReviews,
        rejected: rejectedRevenueReviews,
      },
    });
  } catch (error: any) {
    console.error("Revenue Protection GET Error:", error);
    return NextResponse.json({ error: error.message || "Failed to load revenue protection" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { admin, response } = await requireAdminPermission("dangerous");
  if (response) return response;

  try {
    const body = await request.json();
    const action = clean(body.action);

    if (action === "run_scan") {
      const result = await runRevenueProtectionScan({ autoPause: Boolean(body.auto_pause), actorId: admin?.id });
      return NextResponse.json({ success: true, result });
    }

    if (action === "list_pending_reviews") {
      const reviews = await listSuspiciousRevenueReviews({
        status: clean(body.status || "pending_review"),
        miniapp_id: body.miniapp_id,
        publisher_id: body.publisher_id,
        date: body.date,
        limit: body.limit,
      });
      return NextResponse.json({ success: true, reviews });
    }

    if (action === "approve_review" || action === "reject_review") {
      const statId = toPositiveInt(body.stat_id || body.id);
      if (!statId) {
        return NextResponse.json({ error: "Valid stat_id is required" }, { status: 400 });
      }

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const nextStatus = action === "approve_review" ? "approved" : "rejected";
        const stat = await reviewSuspiciousRevenue({
          conn,
          adminId: admin!.id,
          statId,
          status: nextStatus,
          note: clean(body.note),
        });

        await recordRevenueProtectionAudit({
          actorType: "admin",
          actorId: admin!.id,
          action: nextStatus === "approved" ? "revenue_review_approved" : "revenue_review_rejected",
          entityType: "miniapp_daily_stat",
          entityId: stat.id,
          reason: clean(body.note),
          metadata: {
            admin_id: admin!.id,
            stat_id: stat.id,
            miniapp_id: stat.miniapp_id,
            publisher_id: stat.publisher_id,
            amount: toNumber(stat.publisher_revenue),
            gross_revenue: toNumber(stat.gross_revenue),
            note: clean(body.note),
            reviewed_at: new Date().toISOString(),
          },
        });

        await conn.commit();
        return NextResponse.json({ success: true, review_status: nextStatus, stat_id: stat.id });
      } catch (error: any) {
        await conn.rollback();
        const status = Number(error.statusCode || 500);
        return NextResponse.json({ error: error.message || "Review action failed" }, { status });
      } finally {
        conn.release();
      }
    }

    if (action === "update_setting") {
      await pool.query(
        `INSERT INTO revenue_protection_settings (\`key\`, value, description)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value), description = VALUES(description)`,
        [clean(body.key), clean(body.value), clean(body.description)]
      );
      await recordRevenueProtectionAudit({
        actorType: "admin",
        actorId: admin.id,
        action: "setting_update",
        entityType: "revenue_protection_setting",
        reason: clean(body.key),
        metadata: body,
      });
      return NextResponse.json({ success: true });
    }

    if (action === "upsert_rule") {
      await pool.query(
        `INSERT INTO revenue_protection_rules (rule_key, rule_type, threshold_value, severity, action, active, description)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE rule_type = VALUES(rule_type), threshold_value = VALUES(threshold_value),
          severity = VALUES(severity), action = VALUES(action), active = VALUES(active), description = VALUES(description)`,
        [
          clean(body.rule_key),
          clean(body.rule_type) || "spend",
          toNumber(body.threshold_value),
          clean(body.severity) || "medium",
          clean(body.rule_action) || "alert",
          body.active ? 1 : 0,
          clean(body.description),
        ]
      );
      await recordRevenueProtectionAudit({
        actorType: "admin",
        actorId: admin.id,
        action: "rule_update",
        entityType: "revenue_protection_rule",
        reason: clean(body.rule_key),
        metadata: body,
      });
      return NextResponse.json({ success: true });
    }

    if (["force_resume", "force_pause", "ignore_alert", "mark_safe"].includes(action)) {
      await applyRevenueProtectionOverride({
        action,
        entityType: clean(body.entity_type),
        entityId: Number(body.entity_id),
        reason: clean(body.reason),
        adminId: admin.id,
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    console.error("Revenue Protection PATCH Error:", error);
    return NextResponse.json({ error: error.message || "Revenue protection action failed" }, { status: 500 });
  }
}
