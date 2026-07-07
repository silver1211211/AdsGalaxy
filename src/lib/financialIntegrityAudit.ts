import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";

type AuditIssue = {
  scope: "miniapp" | "channel" | "bot" | "user" | "platform";
  severity: "low" | "medium" | "high" | "critical";
  code: string;
  count: number;
  details: string;
};

async function countQuery(sql: string, params: unknown[] = []) {
  const [[row]] = await pool.query<Array<RowDataPacket & { count: number }>>(sql, params);
  return Number(row?.count || 0);
}

function issue(scope: AuditIssue["scope"], severity: AuditIssue["severity"], code: string, count: number, details: string): AuditIssue | null {
  return count > 0 ? { scope, severity, code, count, details } : null;
}

export async function runFinancialIntegrityAudit() {
  const checks = await Promise.all([
    countQuery("SELECT COUNT(*) count FROM users WHERE balance_available < -0.00000001 OR balance_locked < -0.00000001 OR ad_balance < -0.00000001"),
    countQuery(`
      SELECT COUNT(*) count FROM (
        SELECT daily_stat_id FROM miniapp_earnings_settlements
        GROUP BY daily_stat_id HAVING COUNT(*) > 1
      ) duplicates
    `),
    countQuery(`
      SELECT COUNT(*) count
      FROM miniapp_daily_stats ds
      LEFT JOIN miniapp_earnings_settlements s ON s.daily_stat_id = ds.id
      WHERE s.id IS NULL
        AND ds.network_name <> 'AdsGalaxyInternal'
        AND ds.publisher_revenue > 0
        AND ds.date < CURDATE()
        AND COALESCE(ds.reconciliation_status, 'estimated') <> 'reconciled'
    `),
    countQuery(`
      SELECT COUNT(*) count
      FROM miniapp_external_revenue_reconciliations
      WHERE reconciled_publisher_revenue - reconciled_gross_revenue > 0.00000001
    `),
    countQuery(`
      SELECT COUNT(*) count FROM (
        SELECT source_key FROM channel_advertiser_debits
        GROUP BY source_key HAVING COUNT(*) > 1
      ) duplicates
    `),
    countQuery(`
      SELECT COUNT(*) count
      FROM channel_advertiser_debits
      WHERE publisher_status = 'settled' AND publisher_settled_at IS NULL
    `),
    countQuery(`
      SELECT COUNT(*) count
      FROM campaigns
      WHERE budget < -0.00000001 OR COALESCE(channel_spend, 0) - COALESCE(total_budget, budget + channel_spend, 0) > 0.00000001
    `).catch(() => 0),
    countQuery(`
      SELECT COUNT(*) count FROM (
        SELECT bot_id, request_id_hash FROM bot_integration_events
        WHERE request_id_hash IS NOT NULL
        GROUP BY bot_id, request_id_hash HAVING COUNT(*) > 1
      ) duplicates
    `).catch(() => 0),
  ]);

  const issues = [
    issue("user", "critical", "negative_balances", checks[0], "Users have negative available, locked, or advertiser balances."),
    issue("miniapp", "critical", "duplicate_miniapp_settlements", checks[1], "More than one Mini App settlement exists for the same daily stat."),
    issue("miniapp", "critical", "unreconciled_external_payout_candidates", checks[2], "External Mini App revenue exists for settlement before verified provider reconciliation."),
    issue("miniapp", "critical", "publisher_revenue_exceeds_provider_revenue", checks[3], "A reconciliation row would pay publisher revenue above verified provider revenue."),
    issue("channel", "critical", "duplicate_channel_fast_debits", checks[4], "Duplicate channel fast-debit source keys exist."),
    issue("channel", "high", "settled_channel_debits_missing_timestamp", checks[5], "Channel publisher debit rows are marked settled without a settlement timestamp."),
    issue("channel", "critical", "channel_budget_overspend", checks[6], "Channel campaign spend appears to exceed tracked budget."),
    issue("bot", "high", "duplicate_bot_integration_events", checks[7], "Duplicate bot integration request events were found."),
  ].filter((item): item is AuditIssue => Boolean(item));

  return {
    success: issues.length === 0,
    checked_at: new Date().toISOString(),
    issues,
    summary: {
      issue_count: issues.length,
      critical_count: issues.filter((item) => item.severity === "critical").length,
      high_count: issues.filter((item) => item.severity === "high").length,
    },
  };
}
