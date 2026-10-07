/* eslint-disable @typescript-eslint/no-explicit-any -- union DTO is intentionally normalized for the campaign cards */
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { isStandardChannelReport, getChannelReportingMetrics, channelMetricPayload } from "@/lib/channelReporting";
import { getAuthenticatedUserStatus, getAuthErrorStatus } from "@/lib/auth";
import { logSlowRequest } from "@/lib/performanceTiming";
import { applyMiniAppCampaignMetrics, getMiniAppCampaignMetricsByIds } from "@/lib/miniappCampaignMetrics";

const PAGE_SIZE = 15;

function decodeCursor(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed?.created_at || !Number.isInteger(Number(parsed.id)) || !["regular", "miniapp"].includes(parsed.source)) return null;
    return { created_at: String(parsed.created_at), id: Number(parsed.id), source: String(parsed.source) };
  } catch { return null; }
}

function encodeCursor(row: any) {
  return Buffer.from(JSON.stringify({ created_at: row.created_at, id: Number(row.id), source: row.source })).toString("base64url");
}

async function getRegularCampaignMetricsByIds(campaignIds: Array<number | string>) {
  const ids = [...new Set(campaignIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  const metrics = new Map<number, Record<string, number>>();
  if (ids.length === 0) return metrics;

  const placeholders = ids.map(() => "?").join(",");
  const merge = (rows: any[], values: (row: any) => Record<string, number>) => {
    for (const row of rows) {
      const id = Number(row.campaign_id);
      metrics.set(id, { ...(metrics.get(id) || {}), ...values(row) });
    }
  };

  const [broadcastResult, postsResult, billableViewsResult, clicksResult, growthResult, pendingResult] = await Promise.all([
    pool.query(`SELECT campaign_id, COUNT(*) impressions, COALESCE(SUM(cost),0) spend
      FROM broadcast_deliveries WHERE status='sent' AND campaign_id IN (${placeholders}) GROUP BY campaign_id`, ids),
    pool.query(`SELECT campaign_id, COALESCE(SUM(views),COUNT(*)) impressions,
      COALESCE(SUM(CASE WHEN delivery_confirmed_at IS NOT NULL AND delivery_failed_at IS NULL THEN views ELSE 0 END),0) growth_impressions
      FROM campaign_posts WHERE campaign_id IN (${placeholders}) GROUP BY campaign_id`, ids),
    pool.query(`SELECT campaign_id, SUM(billable_views) billable_views, SUM(settled_spend) settled_spend FROM (
        SELECT campaign_id, CASE WHEN settlement_type='view' THEN units ELSE 0 END billable_views,
          advertiser_debit settled_spend FROM channel_advertiser_debits
        WHERE campaign_id IN (${placeholders})
        UNION ALL
        SELECT l.campaign_id, CASE WHEN l.settlement_type='view' THEN l.new_units ELSE 0 END,
          l.advertiser_debit FROM channel_settlement_ledger l
        LEFT JOIN channel_fraud_billing_adjustments a ON a.settlement_ledger_id=l.id
        WHERE a.id IS NULL AND l.campaign_id IN (${placeholders})
        UNION ALL
        SELECT tp.campaign_id, ts.impression_delta, ts.gross_amount FROM teaser_settlements ts
        JOIN teaser_placements tp ON tp.id=ts.placement_id
        WHERE tp.campaign_id IN (${placeholders})
      ) settled GROUP BY campaign_id`, [...ids, ...ids, ...ids]),
    pool.query(`SELECT campaign_id, COUNT(*) clicks
      FROM campaign_clicks WHERE campaign_id IN (${placeholders}) GROUP BY campaign_id`, ids),
    pool.query(`SELECT campaign_id, COUNT(*) subscribers_acquired,COALESCE(SUM(advertiser_debit),0) subscriber_spend
      FROM channel_growth_conversions WHERE status='billed' AND fraud_status='clear' AND campaign_id IN (${placeholders}) GROUP BY campaign_id`, ids),
    pool.query(`SELECT campaign_id, COUNT(*) pending_verifications
      FROM channel_growth_membership_events WHERE processing_status='pending' AND campaign_id IN (${placeholders}) GROUP BY campaign_id`, ids),
  ]);

  merge(broadcastResult[0] as any[], (row) => ({ broadcast_impressions: Number(row.impressions || 0), broadcast_spend: Number(row.spend || 0) }));
  merge(postsResult[0] as any[], (row) => ({ post_impressions: Number(row.impressions || 0), growth_impressions: Number(row.growth_impressions || 0) }));
  merge(billableViewsResult[0] as any[], (row) => ({
    billable_views: Number(row.billable_views || 0),
    settled_spend: Number(row.settled_spend || 0),
  }));
  merge(clicksResult[0] as any[], (row) => ({ clicks: Number(row.clicks || 0) }));
  merge(growthResult[0] as any[], (row) => ({ subscribers_acquired: Number(row.subscribers_acquired || 0), subscriber_spend: Number(row.subscriber_spend || 0) }));
  merge(pendingResult[0] as any[], (row) => ({ pending_verifications: Number(row.pending_verifications || 0) }));
  return metrics;
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  try {
    const user = await getAuthenticatedUserStatus(request.headers.get("x-telegram-init-data"), { request });
    const cursor = decodeCursor(new URL(request.url).searchParams.get("cursor"));
    const cursorSql = cursor ? `WHERE (feed.created_at < ? OR (feed.created_at = ? AND
      (feed.source > ? OR (feed.source = ? AND feed.id < ?))))` : "";
    const params: unknown[] = [user.id, user.id];
    if (cursor) params.push(cursor.created_at, cursor.created_at, cursor.source, cursor.source, cursor.id);
    params.push(PAGE_SIZE + 1);

    const [rows]: any = await pool.query(
      `SELECT feed.* FROM (
        SELECT 'regular' source, c.id, c.name, c.campaign_title, c.message_text,
          c.image_url, c.link, c.button_text, c.category, c.continents, c.created_at,
          c.type, c.status, c.budget, c.cpm, c.rejection_reason,
          c.campaign_kind, c.teaser_mode, c.billing_model, c.funding_model, c.cost_per_subscriber,
          c.total_budget budget_cap,
          c.budget remaining_allowance,
          CASE
            WHEN c.type = 'broadcast'
              THEN GREATEST(
                COALESCE(c.total_budget, c.budget, 0) - COALESCE(c.budget, 0),
                0
              )
            ELSE COALESCE(c.channel_spend, 0)
          END actual_spend,
          c.pause_reason,
          0 impressions, 0 clicks, 0 spend, 0 subscribers_acquired, 0 pending_verifications
        FROM campaigns c WHERE c.user_id=?
        UNION ALL
        SELECT 'miniapp' source, m.id, m.campaign_name name, m.title campaign_title,
          m.description message_text, m.image_url, m.landing_url link, m.cta_text button_text,
          '' category, '[]' continents, m.created_at, 'rewarded' type, m.status,
          m.budget, m.advertiser_cpm_bid cpm, m.creative_review_notes rejection_reason,
          NULL campaign_kind, NULL teaser_mode, 'cpm' billing_model, m.funding_model, NULL cost_per_subscriber,
          m.budget budget_cap, m.remaining_budget remaining_allowance, m.total_spend actual_spend, m.pause_reason,
          0 impressions, 0 clicks, m.total_spend spend,
          0 subscribers_acquired, 0 pending_verifications
        FROM miniapp_rewarded_campaigns m WHERE m.advertiser_id=?
      ) feed ${cursorSql}
      ORDER BY feed.created_at DESC, feed.source ASC, feed.id DESC LIMIT ?`, params);
    const has_more = rows.length > PAGE_SIZE;
    let results = rows.slice(0, PAGE_SIZE).map((row: any) => ({
      ...row,
      kind: row.source === "miniapp" ? "miniapp" : row.type === "broadcast" ? "bot" : row.campaign_kind === "channel_growth" ? "growth" : "channel",
    }));
    const regularRows = results.filter((row: any) => row.source === "regular");
    const miniappRows = results.filter((row: any) => row.source === "miniapp");
    const [regularMetrics, miniappMetrics] = await Promise.all([
      getRegularCampaignMetricsByIds(regularRows.map((row: any) => row.id)),
      getMiniAppCampaignMetricsByIds(miniappRows.map((row: any) => row.id)),
    ]);
    results = results.map((row: any) => {
      if (row.source === "miniapp") return applyMiniAppCampaignMetrics(row, miniappMetrics);
      const values = regularMetrics.get(Number(row.id)) || {};
      const broadcastSpend =
        row.type === "broadcast"
          ? Number(values.broadcast_spend || 0)
          : 0;

      return {
        ...row,
        impressions: row.type === "broadcast"
          ? Number(values.broadcast_impressions || 0)
          : row.campaign_kind === "channel_growth" ? Number(values.growth_impressions || 0) : row.type === "views"
            ? Number(values.billable_views || 0)
            : Number(values.post_impressions || 0),
        clicks: row.type === "broadcast" ? 0 : Number(values.clicks || 0),
        spend: row.campaign_kind === "channel_growth" ? Number(values.subscriber_spend || 0) : broadcastSpend,
        actual_spend: row.type === "broadcast"
          ? broadcastSpend
          : row.campaign_kind === "channel_growth" ? Number(values.subscriber_spend || 0) : Number(values.settled_spend || 0),
        subscribers_acquired: Number(values.subscribers_acquired || 0),
        pending_verifications: Number(values.pending_verifications || 0),
      };
    });
    const channelMetrics = await getChannelReportingMetrics(pool, results.filter(isStandardChannelReport).map((r: any) => Number(r.id)));
    results = results.map((row: any) => {
      const metrics = channelMetrics.get(Number(row.id));
      return isStandardChannelReport(row) && metrics ? { ...row, ...channelMetricPayload(metrics, row.campaign_kind === "channel_growth") } : row;
    });
    return NextResponse.json({ results, has_more, next_cursor: has_more ? encodeCursor(results[results.length - 1]) : null });
  } catch (error) {
    console.error("Campaign feed error", { error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "Unable to load campaigns right now" }, { status: getAuthErrorStatus(error) });
  } finally { logSlowRequest("/api/advertiser/campaign-feed", startedAt); }
}
