import {
  PUBLISHER_CHANNEL_AUDIENCE_OPTIONS,
  classifyChannelAudience,
  normalizeAudienceKey,
  type ChannelAudienceKey,
} from "@/lib/channelAudience";

export type AudienceAnalyticsKey = ChannelAudienceKey | "all" | "unclassified";

type ChannelCapacityRow = {
  id: number;
  subscriber_count: string | number | null;
  audience_continents: unknown;
  geo_authoritative_region?: unknown;
  geo_confidence?: unknown;
  geo_conflict_detected?: unknown;
  geo_status?: unknown;
};

type ChannelMetricRow = {
  channel_id: number;
  today_views: string | number | null;
  today_clicks: string | number | null;
  weekly_views: string | number | null;
  weekly_clicks: string | number | null;
  monthly_views: string | number | null;
  monthly_clicks: string | number | null;
};

type PeriodMetrics = {
  views: number;
  clicks: number;
  ctr: number;
};

export type AnalyticsPeriodTotals = PeriodMetrics;

export type AudienceAnalyticsSummary = {
  today: PeriodMetrics;
  weekly: PeriodMetrics;
  monthly: PeriodMetrics;
};

export type AudienceAnalyticsItem = {
  key: AudienceAnalyticsKey;
  label: string;
  channels: number;
  subscribers: number;
  today: PeriodMetrics;
  weekly: PeriodMetrics;
  monthly: PeriodMetrics;
};

export type AudienceInventoryScope = {
  active_channels: number;
  audience_classified_active_channels: number;
  authoritative_audience_active_channels: number;
  unknown_audience_active_channels: number;
};

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function calculateCtr(clicks: number, views: number) {
  return views > 0 ? Number(((clicks / views) * 100).toFixed(4)) : 0;
}

export function effectiveChannelAudience(channel: ChannelCapacityRow): ChannelAudienceKey | "unclassified" {
  const authoritative = normalizeAudienceKey(channel.geo_authoritative_region);
  const authoritativeIsCurrent = String(channel.geo_status || "") === "current"
    && !Boolean(channel.geo_conflict_detected)
    && String(channel.geo_confidence || "unknown") !== "unknown";
  if (authoritative && authoritativeIsCurrent) return authoritative;
  return classifyChannelAudience(channel.audience_continents) || "unclassified";
}

function emptyItem(key: AudienceAnalyticsKey, label: string): AudienceAnalyticsItem {
  return {
    key,
    label,
    channels: 0,
    subscribers: 0,
    today: { views: 0, clicks: 0, ctr: 0 },
    weekly: { views: 0, clicks: 0, ctr: 0 },
    monthly: { views: 0, clicks: 0, ctr: 0 },
  };
}

export function buildAudienceAnalytics(channels: ChannelCapacityRow[], metrics: ChannelMetricRow[]) {
  const regionalItems = [
    emptyItem("global", "Global audience"),
    ...PUBLISHER_CHANNEL_AUDIENCE_OPTIONS.map((option) => emptyItem(option.value, option.label)),
    emptyItem("unclassified", "Unclassified / Unknown"),
  ];
  const byKey = new Map(regionalItems.map((item) => [item.key, item]));
  const channelKeys = new Map<number, AudienceAnalyticsKey>();

  for (const channel of channels) {
    const key = effectiveChannelAudience(channel);
    channelKeys.set(Number(channel.id), key);
    const item = byKey.get(key)!;
    item.channels += 1;
    item.subscribers += Math.max(0, numberValue(channel.subscriber_count));
  }

  for (const metric of metrics) {
    const key = channelKeys.get(Number(metric.channel_id));
    if (!key) continue;
    const item = byKey.get(key)!;
    item.today.views += numberValue(metric.today_views);
    item.today.clicks += numberValue(metric.today_clicks);
    item.weekly.views += numberValue(metric.weekly_views);
    item.weekly.clicks += numberValue(metric.weekly_clicks);
    item.monthly.views += numberValue(metric.monthly_views);
    item.monthly.clicks += numberValue(metric.monthly_clicks);
  }

  for (const item of regionalItems) {
    item.today.ctr = calculateCtr(item.today.clicks, item.today.views);
    item.weekly.ctr = calculateCtr(item.weekly.clicks, item.weekly.views);
    item.monthly.ctr = calculateCtr(item.monthly.clicks, item.monthly.views);
  }

  const all = emptyItem("all", "All active channels");
  for (const item of regionalItems) {
    all.channels += item.channels;
    all.subscribers += item.subscribers;
    for (const period of ["today", "weekly", "monthly"] as const) {
      all[period].views += item[period].views;
      all[period].clicks += item[period].clicks;
    }
  }
  for (const period of ["today", "weekly", "monthly"] as const) {
    all[period].ctr = calculateCtr(all[period].clicks, all[period].views);
  }

  return [all, ...regionalItems];
}

export function buildAudienceInventoryScope(channels: ChannelCapacityRow[]): AudienceInventoryScope {
  const audiences = channels.map(effectiveChannelAudience);
  return {
    active_channels: channels.length,
    audience_classified_active_channels: audiences.filter((audience) => audience !== "unclassified").length,
    authoritative_audience_active_channels: channels.filter((channel) => normalizeAudienceKey(channel.geo_authoritative_region)
      && String(channel.geo_status || "") === "current"
      && !Boolean(channel.geo_conflict_detected)
      && String(channel.geo_confidence || "unknown") !== "unknown").length,
    unknown_audience_active_channels: audiences.filter((audience) => audience === "unclassified").length,
  };
}

export function buildAnalyticsSummary(
  audiences: AudienceAnalyticsItem[],
  miniApp: {
    today_views: unknown; today_clicks: unknown;
    weekly_views: unknown; weekly_clicks: unknown;
    monthly_views: unknown; monthly_clicks: unknown;
  },
): AudienceAnalyticsSummary {
  const sum = (period: "today" | "weekly" | "monthly", metric: "views" | "clicks") =>
    audiences
      .filter((audience) => audience.key !== "all")
      .reduce((total, audience) => total + numberValue(audience[period][metric]), 0);
  const period = (name: "today" | "weekly" | "monthly") => {
    const views = sum(name, "views") + numberValue(miniApp[`${name}_views`]);
    const clicks = sum(name, "clicks") + numberValue(miniApp[`${name}_clicks`]);
    return { views, clicks, ctr: calculateCtr(clicks, views) };
  };
  return { today: period("today"), weekly: period("weekly"), monthly: period("monthly") };
}
