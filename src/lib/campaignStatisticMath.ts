export type CampaignStatisticKind = "views" | "clicks";

function metric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fixed(value: number) {
  return Number(value.toFixed(8));
}

export function campaignCtr(clicks: unknown, views: unknown) {
  const denominator = metric(views);
  return denominator > 0 ? fixed((metric(clicks) / denominator) * 100) : 0;
}

export function campaignEffectiveCpm(spend: unknown, billableViews: unknown) {
  const denominator = metric(billableViews);
  return denominator > 0 ? fixed((metric(spend) / denominator) * 1000) : 0;
}

export function campaignAverageCpc(spend: unknown, billableClicks: unknown) {
  const denominator = metric(billableClicks);
  return denominator > 0 ? fixed(metric(spend) / denominator) : 0;
}

export function campaignCostMetric(
  kind: CampaignStatisticKind,
  spend: unknown,
  billableViews: unknown,
  billableClicks: unknown,
) {
  return kind === "views"
    ? campaignEffectiveCpm(spend, billableViews)
    : campaignAverageCpc(spend, billableClicks);
}

export function channelAdvertiserMetrics(input: {
  kind: CampaignStatisticKind;
  rawViews: unknown;
  actualClicks: unknown;
  billableViews: unknown;
  billableClicks: unknown;
  spend: unknown;
}) {
  const rawViews = metric(input.rawViews);
  const actualClicks = metric(input.actualClicks);
  const billableViews = metric(input.billableViews);
  const billableClicks = metric(input.billableClicks);
  const spend = metric(input.spend);

  return {
    rawViews,
    billableViews,
    billableClicks,
    visibleViews: input.kind === "views" ? billableViews : rawViews,
    visibleClicks: actualClicks,
    ctr: campaignCtr(actualClicks, input.kind === "views" ? billableViews : rawViews),
    effectiveCpm: input.kind === "views" ? campaignEffectiveCpm(spend, billableViews) : 0,
    averageCpc: input.kind === "clicks" ? campaignAverageCpc(spend, billableClicks) : 0,
    costMetric: campaignCostMetric(input.kind, spend, billableViews, billableClicks),
  };
}
