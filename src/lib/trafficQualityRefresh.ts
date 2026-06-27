import pool from "@/lib/db";
import { calculateTrafficQuality, maybeQueueTrafficReview, persistTrafficQuality, type TrafficEntityType } from "@/lib/trafficQuality";

export type TrafficQualityRefreshResult = {
  miniapps: number;
  channels: number;
  bots: number;
  platform: boolean;
};

export async function refreshTrafficQualitySnapshots(limit = 200): Promise<TrafficQualityRefreshResult> {
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));
  const result: TrafficQualityRefreshResult = {
    miniapps: 0,
    channels: 0,
    bots: 0,
    platform: false,
  };

  const [miniapps]: any = await pool.query("SELECT id FROM miniapps WHERE is_deleted = FALSE ORDER BY id DESC LIMIT ?", [boundedLimit]);
  const [channels]: any = await pool.query("SELECT id FROM channels WHERE is_deleted = FALSE ORDER BY id DESC LIMIT ?", [boundedLimit]);
  const [bots]: any = await pool.query("SELECT id FROM bots WHERE is_deleted = FALSE ORDER BY id DESC LIMIT ?", [boundedLimit]);

  for (const row of miniapps) {
    const metrics = await calculateTrafficQuality("miniapp", Number(row.id));
    await persistTrafficQuality(metrics);
    await maybeQueueTrafficReview(metrics);
    result.miniapps++;
  }

  for (const row of channels) {
    const metrics = await calculateTrafficQuality("channel", Number(row.id));
    await persistTrafficQuality(metrics);
    await maybeQueueTrafficReview(metrics);
    result.channels++;
  }

  for (const row of bots) {
    const metrics = await calculateTrafficQuality("bot", Number(row.id));
    await persistTrafficQuality(metrics);
    await maybeQueueTrafficReview(metrics);
    result.bots++;
  }

  const platform = await calculateTrafficQuality("platform", 0);
  await persistTrafficQuality(platform);
  result.platform = true;

  return result;
}

export function isTrafficEntityType(value: string): value is Exclude<TrafficEntityType, "platform"> {
  return value === "miniapp" || value === "channel" || value === "bot";
}
