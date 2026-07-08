export const CAMPAIGN_LIFECYCLE_ACTIONS = [
  "pause_only",
  "pause",
  "pause_finalize",
  "resume",
  "delete",
  "retry_cleanup",
  "force_refresh_stats",
  "force_settlement",
  "refresh_and_settle",
] as const;

export type CampaignLifecycleAction = typeof CAMPAIGN_LIFECYCLE_ACTIONS[number];

export type CampaignLifecycleActionSpec = {
  stopsDelivery: boolean;
  refreshesTelegramStats: boolean;
  settlesFinancials: boolean;
  cleansTelegramPosts: boolean;
  deletesCampaign: boolean;
  resumesDelivery: boolean;
};

export const CAMPAIGN_LIFECYCLE_ACTION_SPECS: Record<CampaignLifecycleAction, CampaignLifecycleActionSpec> = {
  pause_only: {
    stopsDelivery: true,
    refreshesTelegramStats: false,
    settlesFinancials: false,
    cleansTelegramPosts: false,
    deletesCampaign: false,
    resumesDelivery: false,
  },
  pause: {
    stopsDelivery: true,
    refreshesTelegramStats: true,
    settlesFinancials: true,
    cleansTelegramPosts: true,
    deletesCampaign: false,
    resumesDelivery: false,
  },
  pause_finalize: {
    stopsDelivery: true,
    refreshesTelegramStats: true,
    settlesFinancials: true,
    cleansTelegramPosts: true,
    deletesCampaign: false,
    resumesDelivery: false,
  },
  resume: {
    stopsDelivery: false,
    refreshesTelegramStats: false,
    settlesFinancials: false,
    cleansTelegramPosts: false,
    deletesCampaign: false,
    resumesDelivery: true,
  },
  delete: {
    stopsDelivery: true,
    refreshesTelegramStats: true,
    settlesFinancials: true,
    cleansTelegramPosts: true,
    deletesCampaign: true,
    resumesDelivery: false,
  },
  retry_cleanup: {
    stopsDelivery: false,
    refreshesTelegramStats: false,
    settlesFinancials: false,
    cleansTelegramPosts: true,
    deletesCampaign: false,
    resumesDelivery: false,
  },
  force_refresh_stats: {
    stopsDelivery: false,
    refreshesTelegramStats: true,
    settlesFinancials: false,
    cleansTelegramPosts: false,
    deletesCampaign: false,
    resumesDelivery: false,
  },
  force_settlement: {
    stopsDelivery: false,
    refreshesTelegramStats: false,
    settlesFinancials: true,
    cleansTelegramPosts: false,
    deletesCampaign: false,
    resumesDelivery: false,
  },
  refresh_and_settle: {
    stopsDelivery: false,
    refreshesTelegramStats: true,
    settlesFinancials: true,
    cleansTelegramPosts: false,
    deletesCampaign: false,
    resumesDelivery: false,
  },
};

export function isCampaignLifecycleAction(action: unknown): action is CampaignLifecycleAction {
  return typeof action === "string" && CAMPAIGN_LIFECYCLE_ACTIONS.includes(action as CampaignLifecycleAction);
}
