import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

type Db = Pool | PoolConnection;
export type ScheduleChannel = { id: number; posting_times?: unknown; scheduler_slot?: string | null; posts_per_day?: number | string | null };

export const DEFAULT_CHANNEL_SCHEDULER_GRACE_MINUTES = 15;

export type ChannelPostingSlotEvaluation = {
  due: boolean;
  slotDate: string | null;
  slotTime: string | null;
  scheduledFor: Date | null;
  windowStartsAt: Date | null;
  windowExpiresAt: Date | null;
  missed: boolean;
  reason: "due" | "before_schedule_slot" | "outside_schedule_grace" | "no_configured_slot";
};

export function configuredChannelSlots(channel: ScheduleChannel) {
  const count = Math.min(3, Math.max(1, Number(channel.posts_per_day || 1)));
  let parsed: unknown = channel.posting_times;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { parsed = []; }
  }
  const valid = Array.isArray(parsed) ? parsed.map(String).filter((value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) : [];
  if (valid.length) return [...new Set(valid)].sort().slice(0, count);
  if (channel.scheduler_slot && /^([01]\d|2[0-3]):[0-5]\d$/.test(channel.scheduler_slot)) return [channel.scheduler_slot];
  return count === 1 ? ["12:00"] : count === 2 ? ["12:00", "18:00"] : ["00:00", "12:00", "18:00"];
}

const minute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
function utcDate(value: Date) {
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function channelSchedulerGraceMinutes(value = process.env.CHANNEL_SCHEDULER_GRACE_MINUTES) {
  const parsed = Number.parseInt(String(value || DEFAULT_CHANNEL_SCHEDULER_GRACE_MINUTES), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_CHANNEL_SCHEDULER_GRACE_MINUTES;
  return Math.min(30, Math.max(1, parsed));
}

/**
 * Evaluates publisher posting times as UTC, matching the existing production
 * UI/storage/server convention. The configured time is the slot identity;
 * scheduler execution time is never rounded into a replacement slot.
 */
export function evaluateChannelPostingSlot(
  channel: ScheduleChannel,
  now = new Date(),
  graceMinutes = channelSchedulerGraceMinutes(),
): ChannelPostingSlotEvaluation {
  const slots = configuredChannelSlots(channel);
  if (!slots.length) {
    return {
      due: false, slotDate: null, slotTime: null, scheduledFor: null,
      windowStartsAt: null, windowExpiresAt: null, missed: false,
      reason: "no_configured_slot",
    };
  }

  const boundedGrace = Math.min(30, Math.max(1, Math.floor(graceMinutes)));
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const candidates = [-1, 0].flatMap((dayOffset) => slots.map((slotTime) => {
    const scheduledFor = new Date(todayUtc + dayOffset * 86_400_000 + minute(slotTime) * 60_000);
    return {
      slotDate: utcDate(scheduledFor),
      slotTime,
      scheduledFor,
      windowExpiresAt: new Date(scheduledFor.getTime() + boundedGrace * 60_000),
    };
  })).sort((left, right) => right.scheduledFor.getTime() - left.scheduledFor.getTime());

  const due = candidates.find((candidate) => (
    now.getTime() >= candidate.scheduledFor.getTime()
    && now.getTime() < candidate.windowExpiresAt.getTime()
  ));
  if (due) {
    return {
      due: true,
      slotDate: due.slotDate,
      slotTime: due.slotTime,
      scheduledFor: due.scheduledFor,
      windowStartsAt: due.scheduledFor,
      windowExpiresAt: due.windowExpiresAt,
      missed: false,
      reason: "due",
    };
  }

  const mostRecent = candidates.find((candidate) => candidate.scheduledFor.getTime() <= now.getTime()) || null;
  const today = utcDate(now);
  const hasFutureToday = candidates.some((candidate) => (
    candidate.slotDate === today && candidate.scheduledFor.getTime() > now.getTime()
  ));
  const missed = Boolean(
    mostRecent
    && now.getTime() >= mostRecent.windowExpiresAt.getTime()
    && (mostRecent.slotDate === today || !hasFutureToday)
  );
  return {
    due: false,
    slotDate: mostRecent?.slotDate || null,
    slotTime: mostRecent?.slotTime || null,
    scheduledFor: mostRecent?.scheduledFor || null,
    windowStartsAt: mostRecent?.scheduledFor || null,
    windowExpiresAt: mostRecent?.windowExpiresAt || null,
    missed,
    reason: missed ? "outside_schedule_grace" : "before_schedule_slot",
  };
}

export async function selectEmergencyScheduleSlot(
  db: Db,
  input: { channel: ScheduleChannel; mode: "fill_empty_slots" | "replace_everything"; bypassTiming: boolean; now?: Date },
) {
  const now = input.now || new Date();
  const slotDate = now.toISOString().slice(0, 10);

  if (input.mode === "fill_empty_slots") {
    // Emergency Fill is capacity-based, not a false claim on a future normal
    // publisher slot. Non-zero seconds keep this identity disjoint from all
    // configured HH:mm normal slots (which are stored as HH:mm:00).
    const hourMinute = `${String(now.getUTCHours()).padStart(2,"0")}:${String(now.getUTCMinutes()).padStart(2,"0")}`;
    const [claimed] = await db.query<Array<RowDataPacket & { slot_time: string }>>(
      `SELECT TIME_FORMAT(slot_time,'%H:%i:%s') slot_time
       FROM channel_schedule_slot_claims
       WHERE channel_id=? AND slot_date=? AND TIME_FORMAT(slot_time,'%H:%i')=? AND released_at IS NULL`,
      [input.channel.id, slotDate, hourMinute],
    );
    const occupied = new Set(claimed.map((row) => String(row.slot_time)));
    const startSecond = Math.max(1, now.getUTCSeconds());
    for (let offset = 0; offset < 59; offset++) {
      const second = ((startSecond - 1 + offset) % 59) + 1;
      const candidate = `${hourMinute}:${String(second).padStart(2,"0")}`;
      if (!occupied.has(candidate)) return { slotDate, slotTime: candidate, replacesPostId: null as number | null };
    }
    return null;
  }

  const [victims] = await db.query<Array<RowDataPacket & { post_id: number; campaign_id: number; delivery_generation: number; slot_date: string | Date; slot_time: string; original_claim_type: "scheduled" | "emergency_fill" | "emergency_replace" | null; live_coverage: number }>>(
    `SELECT cp.id post_id,cp.campaign_id,cp.delivery_generation,
       DATE(COALESCE(cp.posting_slot_date,cp.created_at)) slot_date,
       TIME_FORMAT(COALESCE(cp.posting_slot_time,TIME(cp.created_at)),'%H:%i:%s') slot_time,
       sc.claim_type original_claim_type,
       (SELECT COUNT(*) FROM campaign_posts network_cp
        WHERE network_cp.campaign_id=cp.campaign_id AND network_cp.status IN ('active','posted','sent')
          AND network_cp.deleted_at IS NULL) live_coverage
     FROM campaign_posts cp
     JOIN campaigns c ON c.id=cp.campaign_id AND c.status IN ('active','paused')
     LEFT JOIN channel_schedule_slot_claims sc ON sc.campaign_post_id=cp.id AND sc.released_at IS NULL
     WHERE cp.channel_id=? AND cp.status IN ('active','posted','sent') AND cp.deleted_at IS NULL
     ORDER BY (live_coverage<=1) ASC,live_coverage DESC,
       cp.created_at DESC,cp.id ASC LIMIT 1`, [input.channel.id]);
  const victim = victims[0];
  return victim ? {
    slotDate: victim.slot_date instanceof Date ? victim.slot_date.toISOString().slice(0,10) : String(victim.slot_date).slice(0,10),
    slotTime: String(victim.slot_time),
    replacesPostId: Number(victim.post_id),
    victimCampaignId: Number(victim.campaign_id),
    victimGeneration: Number(victim.delivery_generation || 1),
    victimClaimType: victim.original_claim_type || "scheduled",
    unavoidableCoverageConflict: Number(victim.live_coverage) <= 1,
  } : null;
}
