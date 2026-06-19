export const MAX_CAMPAIGN_SHARE_PER_WINDOW = 0.4;

export interface PlacementCampaign {
  id: number;
  budget: string | number;
}

export interface CampaignScoreContext {
  totalEligibleBudget: number;
  totalSuccessfulPlacementsToday: number;
  actualPlacementsToday: number;
  maxUnderDelivery: number;
  randomization?: number;
}

export function calculateCampaignScore(campaign: PlacementCampaign, context: CampaignScoreContext) {
  const budget = Math.max(0, Number(campaign.budget) || 0);
  const remainingBudgetWeight = context.totalEligibleBudget > 0 ? budget / context.totalEligibleBudget : 0;
  const expectedPlacementsToday = remainingBudgetWeight * context.totalSuccessfulPlacementsToday;
  const underDelivery = Math.max(0, expectedPlacementsToday - context.actualPlacementsToday);
  const underDeliveryScore = context.maxUnderDelivery > 0 ? underDelivery / context.maxUnderDelivery : 0;
  const randomization = context.randomization ?? Math.random();

  return {
    score: (remainingBudgetWeight * 0.60) + (underDeliveryScore * 0.30) + (randomization * 0.10),
    remainingBudgetWeight,
    expectedPlacementsToday,
    actualPlacementsToday: context.actualPlacementsToday,
    underDelivery,
    underDeliveryScore,
    randomization
  };
}

export function getWindowDominanceCap(totalAvailableSlots: number) {
  return Math.max(1, Math.ceil(totalAvailableSlots * MAX_CAMPAIGN_SHARE_PER_WINDOW));
}
