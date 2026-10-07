import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

type Db = Pool | PoolConnection;

type SlotClaimRow = RowDataPacket & {
  id: number;
  campaign_post_id: number | null;
  released_at: Date | string | null;
  post_status: string | null;
  delivery_confirmed_at: Date | string | null;
  delivery_failed_at: Date | string | null;
};

export type ChannelScheduleSlotOccupancy = "available" | "in_flight" | "success" | "blocked_inconsistent";

export function classifyChannelScheduleSlotClaim(row: SlotClaimRow | null): ChannelScheduleSlotOccupancy {
  if (!row || row.released_at || row.delivery_failed_at || row.post_status === "delivery_failed") return "available";
  if (!row.campaign_post_id || row.post_status === "pending_delivery") return "in_flight";
  if (row.delivery_confirmed_at && ["active", "posted", "sent", "replaced", "deleted", "already_missing"].includes(String(row.post_status))) {
    return "success";
  }
  return "blocked_inconsistent";
}

async function loadChannelScheduleSlotClaim(
  db: Db,
  input: { channelId: number; slotDate: string; slotTime: string },
  forUpdate = false,
) {
  const [rows] = await db.query<SlotClaimRow[]>(
    `SELECT sc.id,sc.campaign_post_id,sc.released_at,
       cp.status post_status,cp.delivery_confirmed_at,cp.delivery_failed_at
     FROM channel_schedule_slot_claims sc
     LEFT JOIN campaign_posts cp ON cp.id=sc.campaign_post_id
     WHERE sc.channel_id=? AND sc.slot_date=? AND sc.slot_time=?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [input.channelId, input.slotDate, input.slotTime],
  );
  return rows[0] || null;
}

export async function getChannelScheduleSlotOccupancy(
  db: Db,
  input: { channelId: number; slotDate: string; slotTime: string },
) {
  return classifyChannelScheduleSlotClaim(await loadChannelScheduleSlotClaim(db, input));
}

export async function getChannelScheduleSlotOccupancies(
  db: Db,
  slots: Array<{ channelId: number; slotDate: string; slotTime: string }>,
) {
  const result = new Map<string, ChannelScheduleSlotOccupancy>();
  if (!slots.length) return result;
  const placeholders = slots.map(() => "(?,?,?)").join(",");
  const params = slots.flatMap((slot) => [slot.channelId, slot.slotDate, slot.slotTime]);
  const [rows] = await db.query<Array<SlotClaimRow & { channel_id: number; slot_date: string | Date; slot_time: string }>>(
    `SELECT sc.id,sc.channel_id,sc.slot_date,sc.slot_time,sc.campaign_post_id,sc.released_at,
       cp.status post_status,cp.delivery_confirmed_at,cp.delivery_failed_at
     FROM channel_schedule_slot_claims sc
     LEFT JOIN campaign_posts cp ON cp.id=sc.campaign_post_id
     WHERE (sc.channel_id,sc.slot_date,sc.slot_time) IN (${placeholders})`,
    params,
  );
  for (const row of rows) {
    const slotDate = row.slot_date instanceof Date ? row.slot_date.toISOString().slice(0, 10) : String(row.slot_date).slice(0, 10);
    result.set(`${row.channel_id}:${slotDate}:${String(row.slot_time).slice(0, 5)}`, classifyChannelScheduleSlotClaim(row));
  }
  return result;
}

export async function releaseChannelScheduleSlotClaim(
  conn: PoolConnection,
  input: { claimId: number; postId: number; channelId: number; slotDate: string; slotTime: string },
) {
  const [released] = await conn.query<ResultSetHeader>(
    `UPDATE channel_schedule_slot_claims
     SET released_at=NOW()
     WHERE id=? AND campaign_post_id=? AND channel_id=? AND slot_date=? AND slot_time=? AND released_at IS NULL`,
    [input.claimId, input.postId, input.channelId, input.slotDate, input.slotTime],
  );
  return released.affectedRows === 1;
}

export async function restoreReplacedChannelScheduleSlotClaim(
  conn: PoolConnection,
  input: {
    claimId: number; replacementPostId: number; victimPostId: number;
    victimCampaignId: number; victimGeneration: number;
    victimClaimType: "scheduled" | "emergency_fill" | "emergency_replace";
  },
) {
  const [restored] = await conn.query<ResultSetHeader>(
    `UPDATE channel_schedule_slot_claims
     SET campaign_id=?,campaign_post_id=?,delivery_generation=?,claim_type=?,released_at=NULL
     WHERE id=? AND campaign_post_id=? AND claim_type='emergency_replace'`,
    [input.victimCampaignId,input.victimPostId,input.victimGeneration,input.victimClaimType,input.claimId,input.replacementPostId],
  );
  return restored.affectedRows === 1;
}

export function trackedChannelCtaUrl(host: string, publicCampaignId: number, postId: number) {
  return `${host.replace(/\/$/,"")}/api/clicks/${publicCampaignId}/${postId}`;
}

/**
 * Channel-growth posts still need Telegram's per-placement invite link for
 * membership attribution. Route the button through our click endpoint first,
 * then redirect to that invite; subscriber charges remain membership-based.
 */
export function trackedGrowthCtaUrl(host: string, publicCampaignId: number, postId: number) {
  return `${trackedChannelCtaUrl(host, publicCampaignId, postId)}?growth=1`;
}

export function channelDeliveryClaimKey(campaignId: number, channelId: number, generation: number) {
  return `channel:${campaignId}:${channelId}:generation:${generation}`;
}

export async function reserveChannelPlacement(conn: PoolConnection, input: {
  campaignId: number; channelId: number; channelUsername: string | null;
  generation: number; mode: "scheduled" | "emergency";
  postingSlotDate?: string; postingSlotTime?: string;
  claimType?: "scheduled" | "emergency_fill" | "emergency_replace";
  replacesPostId?: number | null;
  capacityLimit?: number;
}) {
  if (input.capacityLimit && !input.replacesPostId) {
    await conn.query("SELECT id FROM channels WHERE id=? FOR UPDATE", [input.channelId]);
    const [[usage]] = await conn.query<Array<RowDataPacket & { used_capacity: number }>>(
      `SELECT COUNT(*) used_capacity FROM campaign_posts
       WHERE channel_id=?
         AND created_at>=UTC_DATE() AND created_at<DATE_ADD(UTC_DATE(),INTERVAL 1 DAY)
         AND delivery_failed_at IS NULL
         AND (
           (delivery_confirmed_at IS NOT NULL AND status IN ('active','posted','sent','deleted','already_missing'))
           OR status='pending_delivery'
         )`,
      [input.channelId],
    );
    if (Number(usage?.used_capacity || 0) >= Math.max(1, Number(input.capacityLimit))) {
      return {claimed:false,postId:0,claimKey:channelDeliveryClaimKey(input.campaignId,input.channelId,input.generation),slotClaimId:0,reason:"channel_capacity_exhausted"};
    }
  }
  const claimKey=channelDeliveryClaimKey(input.campaignId,input.channelId,input.generation);
  const columns=["campaign_id","delivery_generation","delivery_claim_key","channel_id","channel_username","status","delivery_attempted_at","posting_mode"];
  const values: Array<string|number|Date|null>=[input.campaignId,input.generation,claimKey,input.channelId,input.channelUsername,"pending_delivery",new Date(),input.mode];
  if(input.postingSlotDate&&input.postingSlotTime){columns.push("posting_slot_date","posting_slot_time");values.push(input.postingSlotDate,input.postingSlotTime);}
  let slotClaimId = 0;
  let slotClaimCreated = false;
  let slotClaimReused = false;
  let slotClaimTransferred = false;
  if (input.postingSlotDate && input.postingSlotTime) {
    let slotClaimed = false;
    if (input.mode === "scheduled") {
      const existing = await loadChannelScheduleSlotClaim(conn, {
        channelId: input.channelId,
        slotDate: input.postingSlotDate,
        slotTime: input.postingSlotTime,
      }, true);
      const occupancy = classifyChannelScheduleSlotClaim(existing);
      if (occupancy !== "available") {
        return {claimed:false,postId:0,claimKey,slotClaimId:existing?.id || 0,reason:"schedule_slot_claim_exists"};
      }
      if (existing) {
        const [reclaimed] = await conn.query<ResultSetHeader>(
          `UPDATE channel_schedule_slot_claims
           SET campaign_id=?,campaign_post_id=NULL,delivery_generation=?,claim_type='scheduled',released_at=NULL,created_at=NOW()
           WHERE id=?`,
          [input.campaignId,input.generation,existing.id],
        );
        slotClaimed = reclaimed.affectedRows === 1;
        slotClaimId = Number(existing.id);
        slotClaimReused = slotClaimed;
      }
    } else if (input.replacesPostId) {
      const [transfer] = await conn.query<ResultSetHeader>(
        `UPDATE channel_schedule_slot_claims SET campaign_id=?,campaign_post_id=NULL,delivery_generation=?,claim_type='emergency_replace',released_at=NULL
         WHERE channel_id=? AND slot_date=? AND slot_time=? AND campaign_post_id=? AND released_at IS NULL`,
        [input.campaignId,input.generation,input.channelId,input.postingSlotDate,input.postingSlotTime,input.replacesPostId]);
      slotClaimed = transfer.affectedRows === 1;
      slotClaimTransferred = slotClaimed;
    }
    if (!slotClaimed) {
      const [slot] = await conn.query<ResultSetHeader>(
        `INSERT IGNORE INTO channel_schedule_slot_claims
          (channel_id,slot_date,slot_time,campaign_id,delivery_generation,claim_type)
         VALUES (?,?,?,?,?,?)`,
        [input.channelId,input.postingSlotDate,input.postingSlotTime,input.campaignId,input.generation,input.claimType || (input.mode === "scheduled" ? "scheduled" : "emergency_fill")]);
      if (slot.affectedRows !== 1) return {claimed:false,postId:0,claimKey,slotClaimId:0,reason:"schedule_slot_claim_exists"};
      slotClaimId = Number(slot.insertId || 0);
      slotClaimCreated = true;
    }
  }
  await conn.query(
    `UPDATE campaign_posts
     SET delivery_claim_key=NULL
     WHERE delivery_claim_key=? AND delivery_confirmed_at IS NULL
       AND (delivery_failed_at IS NOT NULL OR status='delivery_failed')`,
    [claimKey],
  );
  const [result]=await conn.query<ResultSetHeader>(`INSERT IGNORE INTO campaign_posts (${columns.join(",")}) VALUES (${columns.map(()=>"?").join(",")})`,values);
  const postId=Number(result.insertId||0);
  if(result.affectedRows!==1) return {claimed:false,postId:0,claimKey,slotClaimId,reason:"delivery_claim_exists"};
  if (input.postingSlotDate && input.postingSlotTime) {
    if (slotClaimId) {
      await conn.query(
        "UPDATE channel_schedule_slot_claims SET campaign_post_id=? WHERE id=? AND campaign_post_id IS NULL",
        [postId,slotClaimId]);
    } else {
      await conn.query(
        "UPDATE channel_schedule_slot_claims SET campaign_post_id=? WHERE channel_id=? AND slot_date=? AND slot_time=? AND campaign_post_id IS NULL",
        [postId,input.channelId,input.postingSlotDate,input.postingSlotTime]);
    }
  }
  return {claimed:true,postId,claimKey,slotClaimId,slotClaimCreated,slotClaimReused,slotClaimTransferred};
}
