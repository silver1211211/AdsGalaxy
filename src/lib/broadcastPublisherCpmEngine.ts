import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { money } from "@/lib/channelBilling";

export const BROADCAST_PUBLISHER_SHARE_KEY = "broadcast_publisher_share_percent";
export const BROADCAST_RESERVE_KEY = "broadcast_reserve_percent";

export type BroadcastPayoutSettings = {
  publisher_share_percent: number;
  reserve_percent: number;
};

export type BroadcastPayout = {
  advertiserDebit: number;
  publisherReward: number;
  reserveAmount: number;
  platformRevenue: number;
};

const DEFAULT_SETTINGS: BroadcastPayoutSettings = {
  publisher_share_percent: 30,
  reserve_percent: 10,
};

function percent(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function assertBroadcastRevenueSplit(settings: BroadcastPayoutSettings) {
  const publisherShare = percent(settings.publisher_share_percent, -1);
  const reserve = percent(settings.reserve_percent, -1);
  if (publisherShare < 0 || publisherShare > 100 || reserve < 0 || reserve > 100) {
    throw new Error("Bot publisher share and reserve must be between 0 and 100");
  }
  if (publisherShare + reserve > 100) {
    throw new Error("Bot publisher share plus reserve cannot exceed 100%");
  }
}

export async function getBroadcastPayoutSettings(conn?: PoolConnection): Promise<BroadcastPayoutSettings> {
  const db = conn || pool;
  const [rows] = await db.query<Array<RowDataPacket & { key: string; value: string }>>(
    "SELECT `key`, value FROM settings WHERE `key` IN (?, ?)",
    [BROADCAST_PUBLISHER_SHARE_KEY, BROADCAST_RESERVE_KEY]
  );
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const settings = {
    publisher_share_percent: percent(values.get(BROADCAST_PUBLISHER_SHARE_KEY), DEFAULT_SETTINGS.publisher_share_percent),
    reserve_percent: percent(values.get(BROADCAST_RESERVE_KEY), DEFAULT_SETTINGS.reserve_percent),
  };
  assertBroadcastRevenueSplit(settings);
  return settings;
}

export function calculateBroadcastPayout(advertiserCpm: unknown, settings: BroadcastPayoutSettings): BroadcastPayout {
  assertBroadcastRevenueSplit(settings);
  const advertiserDebit = money(Math.max(0, Number(advertiserCpm) || 0) / 1000);
  const publisherReward = money(advertiserDebit * (settings.publisher_share_percent / 100));
  const reserveAmount = money(advertiserDebit * (settings.reserve_percent / 100));
  const platformRevenue = money(Math.max(0, advertiserDebit - publisherReward - reserveAmount));
  return {
    advertiserDebit,
    publisherReward,
    reserveAmount,
    platformRevenue,
  };
}

export function broadcastDisplayedImpressions(successfulBroadcasts: unknown) {
  return Math.floor(Math.max(0, Number(successfulBroadcasts) || 0) / 5);
}

export function broadcastReportingCpm(amount: unknown, displayedImpressions: unknown) {
  const impressions = Math.max(0, Number(displayedImpressions) || 0);
  return impressions > 0 ? money((Math.max(0, Number(amount) || 0) / impressions) * 1000) : 0;
}
