export const MAX_CAMPAIGN_SHARE_PER_WINDOW = 0.4;

export interface PlacementCampaign {
  id: number;
  budget: string | number;
  cpm?: string | number;
  cpc?: string | number;
  quality_score?: string | number;
  advertiser_trust_level?: string;
  campaign_priority_score?: string | number;
  financial_policy_version?: string | null;
  smart_reach_effective_cpm?: string | number | null;
  smart_reach_max_cpm?: string | number | null;
  verified_ctr?: number;
}

export interface CampaignScoreContext {
  totalEligibleBudget: number;
  totalSuccessfulPlacementsToday: number;
  actualPlacementsToday: number;
  maxUnderDelivery: number;
  trustMultipliers?: Record<string, number>;
  randomization?: number;
  inventoryScore?: number;
  normalizedAllocationBid?: number;
  maxExpectedEcpm?: number;
}

/** Ranking only: CPC bid is per thousand clicks, so bid * CTR is per thousand views. */
export function expectedCampaignEcpm(campaign: PlacementCampaign) {
  const bid = Math.max(0,Number(campaign.cpc||0));
  const ctr = Math.max(0,Math.min(0.20,Number(campaign.verified_ctr ?? 0.005)));
  const clickValue = bid * ctr;
  if(campaign.financial_policy_version!=="adsgalaxy-smart-reach-v1")return clickValue;
  const maximum = Math.max(0.10,Math.min(0.50,Number(campaign.smart_reach_max_cpm||0.10)));
  const effective = Math.max(0.10,Math.min(maximum,Number(campaign.smart_reach_effective_cpm||0.10)));
  return clickValue + effective + (maximum-effective)*0.15;
}

export function calculateCampaignScore(campaign: PlacementCampaign, context: CampaignScoreContext) {
  const budget = Math.max(0, Number(campaign.budget) || 0);
  const remainingBudgetWeight = context.totalEligibleBudget > 0 ? budget / context.totalEligibleBudget : 0;
  const expectedPlacementsToday = remainingBudgetWeight * context.totalSuccessfulPlacementsToday;
  const underDelivery = Math.max(0, expectedPlacementsToday - context.actualPlacementsToday);
  const underDeliveryScore = context.maxUnderDelivery > 0 ? underDelivery / context.maxUnderDelivery : 0;
  const trustLevel = String(campaign.advertiser_trust_level || "new").toLowerCase();
  const trustMultiplier = context.trustMultipliers?.[trustLevel] ?? 1;
  const quality = Math.max(0, Math.min(100, Number(campaign.quality_score ?? 50) || 50));
  const qualityBoost = 0.7 + (quality / 100) * 0.6;
  const normalizedAllocationBid = Math.max(0, Math.min(1, Number(context.normalizedAllocationBid || 0)));
  const allocationBidBoost = 0.75 + (normalizedAllocationBid * 0.75);
  const campaignPriority = Math.max(0, Math.min(100, Number(campaign.campaign_priority_score ?? quality) || quality));
  const inventoryScore = Math.max(0, Math.min(100, Number(context.inventoryScore ?? 50) || 50));
  const qualityMatch = 1 - Math.abs(campaignPriority - inventoryScore) / 100;
  const randomization = context.randomization ?? Math.random();
  const priorityBoost = 0.7 + (campaignPriority / 100) * 0.6;
  const matchBoost = 0.8 + qualityMatch * 0.4;
  const baseScore = (remainingBudgetWeight * 0.48) + (underDeliveryScore * 0.22) + (allocationBidBoost * 0.10) + (qualityMatch * 0.12) + (randomization * 0.08);
  const expectedValue = expectedCampaignEcpm(campaign);
  const valueBoost = context.maxExpectedEcpm && context.maxExpectedEcpm>0
    ? 0.90 + Math.min(1,expectedValue/context.maxExpectedEcpm)*0.25 : 1;

  return {
    score: baseScore * trustMultiplier * qualityBoost * priorityBoost * matchBoost * valueBoost,
    expectedEcpm: expectedValue,
    remainingBudgetWeight,
    expectedPlacementsToday,
    actualPlacementsToday: context.actualPlacementsToday,
    underDelivery,
    underDeliveryScore,
    randomization,
    trustMultiplier,
    qualityBoost,
    allocationBidBoost,
    normalizedAllocationBid,
    campaignPriority,
    inventoryScore,
    qualityMatch,
    priorityBoost,
    matchBoost
  };
}

export function getWindowDominanceCap(totalAvailableSlots: number) {
  return Math.max(1, Math.ceil(totalAvailableSlots * MAX_CAMPAIGN_SHARE_PER_WINDOW));
}
