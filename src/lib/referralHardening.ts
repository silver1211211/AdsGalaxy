export const REFERRAL_REWARDS = {
  registration: "0.00500000",
  verification: "0.01000000",
  ordinaryMaximum: "0.01500000",
} as const;

export const SPRINT_PRIZES = ["1.00000000", "0.50000000", "0.25000000"] as const;
export const TEAM_SPRINT_POOLS = ["1.50000000", "0.75000000", "0.25000000"] as const;
export const PAYOUT_CAPS = {
  sprintUser: "1.50000000",
  dailyUser: "0.50000000",
  monthlyUser: "5.00000000",
  monthlyPlatform: "25.00000000",
  publisherCommissionLifetime: "1.00000000",
} as const;

export const MILESTONE_REWARDS = new Map<number, string>([
  [3, "0.02000000"], [10, "0.05000000"], [25, "0.15000000"],
  [50, "0.30000000"], [100, "0.75000000"], [200, "1.50000000"], [500, "3.00000000"],
]);

const SCALE = 100_000_000;

export function decimalToUnits(value: unknown): number {
  const raw = String(value ?? "0").trim();
  const negative = raw.startsWith("-");
  const [whole = "0", fraction = ""] = raw.replace(/^[+-]/, "").split(".");
  const units = Number(whole || "0") * SCALE + Number((fraction + "00000000").slice(0, 8));
  return negative ? -units : units;
}

export function unitsToDecimal(value: number): string {
  const negative = value < 0;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${Math.floor(absolute / SCALE)}.${String(absolute % SCALE).padStart(8, "0")}`;
}

export function minimumUnits(...values: number[]) {
  return values.reduce((minimum, value) => value < minimum ? value : minimum);
}

export function referralIdempotencyKey(rewardType: string, sourceId: number | string, context?: number | string | null) {
  return [rewardType, sourceId, context ?? "none"].join(":");
}

// Authoritative sprint qualification. It intentionally separates ordinary Telegram
// verification from meaningful platform activity and never returns private signals.
export const SPRINT_ELIGIBILITY_SQL = `
  r.verification_status = 'verified'
  AND r.status NOT IN ('fraud','rejected','banned','deleted','reversed')
  AND r.reward_status NOT IN ('fraud','rejected','blocked','reversed')
  AND COALESCE(r.self_referral_blocked,0) = 0
  AND r.created_at >= s.starts_at AND r.created_at < s.ends_at
  AND ru.id <> r.invited_by
  AND COALESCE(ru.is_banned,0) = 0
  AND COALESCE(ru.status,'active') NOT IN ('banned','deleted','rejected')
  AND NOT EXISTS (
    SELECT 1 FROM referrals reciprocal
    WHERE reciprocal.user_id = r.invited_by AND reciprocal.invited_by = r.user_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM users duplicate_tg
    WHERE duplicate_tg.telegram_id = ru.telegram_id AND duplicate_tg.id <> ru.id AND ru.telegram_id IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM referral_abuse_flags af
    WHERE af.referral_id = r.id AND af.status = 'open'
      AND af.signal_key IN ('same_ip_or_device_self_referral','shared_signal_cluster','mass_referral_creation','referral_loop','duplicate_telegram_identity')
  )
  AND (
    EXISTS (SELECT 1 FROM channels c WHERE c.user_id=ru.id AND c.status='active' AND COALESCE(c.is_deleted,0)=0 AND (COALESCE(c.last_successful_post_at,c.last_successful_view_fetch_at,c.last_successful_settlement_at) IS NOT NULL OR COALESCE(c.subscriber_count,0)>0))
    OR EXISTS (SELECT 1 FROM bots b WHERE b.user_id=ru.id AND b.status='active' AND COALESCE(b.is_deleted,0)=0 AND (b.integration_last_received_at IS NOT NULL OR b.last_successful_broadcast_at IS NOT NULL))
    OR EXISTS (SELECT 1 FROM miniapps m WHERE m.user_id=ru.id AND m.status='approved' AND COALESCE(m.is_deleted,0)=0 AND (m.traffic_quality_updated_at IS NOT NULL OR m.marketplace_monthly_impressions>0))
    OR EXISTS (SELECT 1 FROM campaigns cpn WHERE cpn.user_id=ru.id AND cpn.status IN ('active','paused','budget_exhausted') AND COALESCE(cpn.total_budget,cpn.budget,0)>0)
    OR EXISTS (SELECT 1 FROM deposits d WHERE d.user_id=ru.id AND d.status='paid' AND d.confirmed_at IS NOT NULL AND d.reversed_at IS NULL)
    OR COALESCE((SELECT SUM(sl.platform_revenue) FROM channel_settlement_ledger sl WHERE sl.publisher_id=ru.id),0) >= 0.10000000
  )`;
