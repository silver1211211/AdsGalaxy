export type AdvertiserCampaignType = "views" | "clicks" | "broadcast" | "miniapp";

type CampaignMetricSource = {
  type?: unknown;
  clicks?: unknown;
  conversions?: unknown;
};

export type AdvertiserDashboardMetric = {
  value: number;
  label: "Click" | "Clicks" | "Conversion" | "Conversions";
};

function metricNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function selectAdvertiserDashboardMetric(
  campaign: CampaignMetricSource,
): AdvertiserDashboardMetric {
  if (campaign.type === "views" || campaign.type === "clicks") {
    const value = metricNumber(campaign.clicks);
    return { value, label: value === 1 ? "Click" : "Clicks" };
  }

  if (campaign.type === "miniapp") {
    const value = metricNumber(campaign.conversions);
    return { value, label: value === 1 ? "Conversion" : "Conversions" };
  }

  // Broadcast and unexpected runtime types retain the previous card behavior.
  return { value: metricNumber(campaign.conversions), label: "Conversions" };
}
