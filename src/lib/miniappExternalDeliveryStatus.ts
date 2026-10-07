/** Canonical persisted states for miniapp_external_delivery_syncs.status. */
export const MINIAPP_EXTERNAL_DELIVERY_SYNC_STATUSES = ["scheduled", "running", "paused", "daily_cap_paused", "insufficient_balance_paused", "funding_paused", "budget_exhausted", "incomplete", "completed", "cancelled", "failed"] as const;
export type MiniAppExternalDeliverySyncStatus = typeof MINIAPP_EXTERNAL_DELIVERY_SYNC_STATUSES[number];
export const MINIAPP_EXTERNAL_DELIVERY_SYNC_STATUS_COLUMN_LENGTH = 64;
export const ACTIVE_MINIAPP_EXTERNAL_DELIVERY_SYNC_STATUSES = ["running", "paused", "daily_cap_paused", "insufficient_balance_paused"] as const satisfies readonly MiniAppExternalDeliverySyncStatus[];
export function isMiniAppExternalDeliverySyncStatus(value: unknown): value is MiniAppExternalDeliverySyncStatus { return typeof value === "string" && (MINIAPP_EXTERNAL_DELIVERY_SYNC_STATUSES as readonly string[]).includes(value); }
export function requireMiniAppExternalDeliverySyncStatus(value: unknown): MiniAppExternalDeliverySyncStatus { if (!isMiniAppExternalDeliverySyncStatus(value)) throw new Error("invalid_miniapp_external_delivery_sync_status"); return value; }
export function isActiveMiniAppExternalDeliverySyncStatus(value: unknown) { return typeof value === "string" && (ACTIVE_MINIAPP_EXTERNAL_DELIVERY_SYNC_STATUSES as readonly string[]).includes(value); }
