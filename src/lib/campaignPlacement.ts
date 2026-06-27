export const MAX_CAMPAIGN_SHARE_PER_WINDOW = 0.4;

export interface PlacementCampaign {
  id: number;
  budget: string | number;
  cpm?: string | number;
  quality_score?: string | number;
  advertiser_trust_level?: string;
  campaign_priority_score?: string | number;
}

export interface CampaignScoreContext {
  totalEligibleBudget: number;
  totalSuccessfulPlacementsToday: number;
  actualPlacementsToday: number;
  maxUnderDelivery: number;
  trustMultipliers?: Record<string, number>;
  randomization?: number;
  inventoryScore?: number;
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
  const cpmBoost = Math.min(1.5, Math.max(0.75, (Number(campaign.cpm || 0) || 0) / 2));
  const campaignPriority = Math.max(0, Math.min(100, Number(campaign.campaign_priority_score ?? quality) || quality));
  const inventoryScore = Math.max(0, Math.min(100, Number(context.inventoryScore ?? 50) || 50));
  const qualityMatch = 1 - Math.abs(campaignPriority - inventoryScore) / 100;
  const randomization = context.randomization ?? Math.random();
  const priorityBoost = 0.7 + (campaignPriority / 100) * 0.6;
  const matchBoost = 0.8 + qualityMatch * 0.4;
  const baseScore = (remainingBudgetWeight * 0.48) + (underDeliveryScore * 0.22) + (cpmBoost * 0.10) + (qualityMatch * 0.12) + (randomization * 0.08);

  return {
    score: baseScore * trustMultiplier * qualityBoost * priorityBoost * matchBoost,
    remainingBudgetWeight,
    expectedPlacementsToday,
    actualPlacementsToday: context.actualPlacementsToday,
    underDelivery,
    underDeliveryScore,
    randomization,
    trustMultiplier,
    qualityBoost,
    cpmBoost,
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
