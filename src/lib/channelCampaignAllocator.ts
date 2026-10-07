export const SUCCESSFUL_CHANNEL_POST_STATUSES = [
  "active",
  "posted",
  "sent",
  "replaced",
  "deleted",
  "already_missing",
  "delete_failed",
] as const;

export type AllocatorCampaign = {
  id: number;
  type?: string;
  campaign_kind?: string;
  cpm?: string | number | null;
  cpc?: string | number | null;
  cost_per_subscriber?: string | number | null;
  is_prioritized?: boolean | number | null;
};

export type SuccessfulPlacementShape = {
  delivery_confirmed_at?: Date | string | null;
  delivery_failed_at?: Date | string | null;
};

export type RankedCampaignCandidate<T extends AllocatorCampaign> = {
  campaign: T;
  score: number;
  successfulThisRun: number;
  lifetimeSuccessful: number;
  lastSuccessfulPlacementAt: Date | string | null;
};

export function isSuccessfulChannelPlacement(row: SuccessfulPlacementShape) {
  return Boolean(row.delivery_confirmed_at) && !row.delivery_failed_at;
}

export function successfulChannelPlacementSql(alias = "cp") {
  const safeAlias = /^[A-Za-z_][A-Za-z0-9_]*$/.test(alias) ? alias : "cp";
  return `${safeAlias}.delivery_confirmed_at IS NOT NULL AND ${safeAlias}.delivery_failed_at IS NULL`;
}

export function campaignPricingBucket(campaign: AllocatorCampaign) {
  if (campaign.campaign_kind === "channel_growth") return "cps";
  return campaign.type === "clicks" ? "cpc" : "cpm";
}

export function campaignAllocationBid(campaign: AllocatorCampaign) {
  const bucket = campaignPricingBucket(campaign);
  const raw = bucket === "cpc"
    ? campaign.cpc
    : bucket === "cps"
      ? campaign.cost_per_subscriber
      : campaign.cpm;
  const bid = Number(raw || 0);
  return Number.isFinite(bid) && bid > 0 ? bid : 0;
}

export function buildAllocationBidMaxima(campaigns: AllocatorCampaign[]) {
  const maxima = new Map<string, number>();
  for (const campaign of campaigns) {
    const bucket = campaignPricingBucket(campaign);
    maxima.set(bucket, Math.max(maxima.get(bucket) || 0, campaignAllocationBid(campaign)));
  }
  return maxima;
}

export function normalizedCampaignAllocationBid(campaign: AllocatorCampaign, maxima: Map<string, number>) {
  const maximum = maxima.get(campaignPricingBucket(campaign)) || 0;
  if (maximum <= 0) return 0;
  return Math.max(0, Math.min(1, campaignAllocationBid(campaign) / maximum));
}

export function applyBoundedPriorityBoost(score: number, prioritized: unknown) {
  return score * (prioritized ? 1.12 : 1);
}

export function deterministicAllocationTieBreaker(seed: string, channelId: number, campaignId: number) {
  const input = `${seed}:${channelId}:${campaignId}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function successfulAt(value: Date | string | null) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function rankEligibleCampaigns<T extends AllocatorCampaign>(input: {
  candidates: Array<RankedCampaignCandidate<T>>;
  dominanceCap: number;
  channelId: number;
  seed: string;
}) {
  const dominanceEligible = input.candidates.length <= 1
    ? input.candidates
    : input.candidates.filter((candidate) => candidate.successfulThisRun < input.dominanceCap);
  const zeroServed = dominanceEligible.filter((candidate) => candidate.successfulThisRun === 0);
  const fairnessFloorApplied = zeroServed.length > 0;
  const pool = fairnessFloorApplied ? zeroServed : dominanceEligible;

  const ranked = [...pool].sort((left, right) => {
    if (fairnessFloorApplied) {
      const leftNeverDelivered = left.lifetimeSuccessful === 0 && !left.lastSuccessfulPlacementAt;
      const rightNeverDelivered = right.lifetimeSuccessful === 0 && !right.lastSuccessfulPlacementAt;
      if (leftNeverDelivered !== rightNeverDelivered) return leftNeverDelivered ? -1 : 1;
      const lastSuccessDifference = successfulAt(left.lastSuccessfulPlacementAt) - successfulAt(right.lastSuccessfulPlacementAt);
      if (lastSuccessDifference !== 0) return lastSuccessDifference;
    }

    const leftScore = applyBoundedPriorityBoost(left.score, left.campaign.is_prioritized);
    const rightScore = applyBoundedPriorityBoost(right.score, right.campaign.is_prioritized);
    if (leftScore !== rightScore) return rightScore - leftScore;
    return deterministicAllocationTieBreaker(input.seed, input.channelId, left.campaign.id)
      - deterministicAllocationTieBreaker(input.seed, input.channelId, right.campaign.id);
  });

  return { ranked, fairnessFloorApplied, dominanceEligibleCount: dominanceEligible.length };
}

export function zeroDeliveryReason(input: {
  successfulThisRun: number;
  compatibleChannels: number;
  frequencyEligibleChannels: number;
  candidateAttempts: number;
}) {
  if (input.successfulThisRun > 0) return null;
  if (input.compatibleChannels === 0) return "NO_COMPATIBLE_CHANNEL_IN_WINDOW";
  if (input.frequencyEligibleChannels === 0) return "FREQUENCY_CAPPED";
  if (input.candidateAttempts === 0) return "FAIRNESS_OR_DOMINANCE_NOT_REACHED";
  return "ATTEMPTED_WITHOUT_SUCCESS";
}
