import type { PoolConnection } from "mysql2/promise";
import pool from "@/lib/db";
import crypto from "crypto";
import { refreshSubscriberChannel } from "@/lib/channelSubscriberRefresh";

export const PROMOTE_SLUG = "promote-ads-galaxy";
export const PROMOTE_DURATION_DAYS = 3;

export const PROMOTE_TIERS = [
  { minimum: 2_000, maximum: 9_999, amount: "0.50000000" },
  { minimum: 10_000, maximum: 49_999, amount: "1.00000000" },
  { minimum: 50_000, maximum: 199_999, amount: "2.50000000" },
  { minimum: 200_000, maximum: 999_999, amount: "6.00000000" },
  { minimum: 1_000_000, maximum: 9_999_999, amount: "15.00000000" },
  { minimum: 10_000_000, maximum: 20_000_000, amount: "50.00000000" },
] as const;

export function rewardTierForAudience(audience: unknown) {
  const count = typeof audience === "bigint" ? audience : BigInt(String(audience));
  if (count > BigInt(20_000_000)) return { status: "manual_review" as const, amount: "0.00000000", tier: null };
  const tier = PROMOTE_TIERS.find((entry) => count >= BigInt(entry.minimum) && count <= BigInt(entry.maximum));
  if (!tier) return { status: "rejected" as const, amount: "0.00000000", tier: null };
  return { status: "qualified" as const, amount: tier.amount, tier };
}

function normalizeChannelIdentity(value: unknown) {
  return `telegram:${String(value || "").trim()}`;
}

async function audit(db: typeof pool | PoolConnection, input: {
  campaignId?: number | null; actorType?: string; actorId?: number | null; action: string;
  entityType: string; entityId?: number | null; reason?: string | null; metadata?: unknown;
}) {
  await db.query(
    `INSERT INTO publisher_promotion_audit_logs
      (campaign_id,actor_type,actor_id,action,entity_type,entity_id,reason,metadata)
     VALUES(?,?,?,?,?,?,?,?)`,
    [input.campaignId || null, input.actorType || "system", input.actorId || null, input.action,
      input.entityType, input.entityId || null, input.reason || null, JSON.stringify(input.metadata || {})]
  );
}

export async function getPromoteCampaign(db: typeof pool | PoolConnection = pool) {
  const [rows]: any = await db.query(
    "SELECT * FROM publisher_promotion_campaigns WHERE slug=? LIMIT 1",
    [PROMOTE_SLUG]
  );
  return rows[0] || null;
}

function effectiveStatus(campaign: any) {
  const now = Date.now();
  if (campaign.status === "paid" && campaign.completion_expires_at
      && new Date(campaign.completion_expires_at).getTime() <= now) return "expired";
  if (campaign.status === "paid" && campaign.payment_confirmed_at) return "paid";
  if (campaign.ends_at && new Date(campaign.ends_at).getTime() <= now) return "closed";
  if (campaign.starts_at && new Date(campaign.starts_at).getTime() <= now && campaign.status === "scheduled") return "active";
  return String(campaign.status);
}

export async function trackCampaignReferrals(db: typeof pool | PoolConnection = pool) {
  const campaign = await getPromoteCampaign(db);
  if (!campaign || !["active", "paused", "closed", "payout_review"].includes(String(campaign.status)) || !campaign.starts_at || !campaign.ends_at) return 0;
  const [result]: any = await db.query(
    `INSERT IGNORE INTO publisher_promotion_referrals
      (campaign_id,referral_id,promoter_user_id,referred_user_id,referral_created_at,status,eligibility_snapshot)
     SELECT ?,r.id,r.invited_by,r.user_id,r.created_at,'tracked',
       JSON_OBJECT('referral_id',r.id,'referral_created_at',r.created_at,'source','referrals')
     FROM publisher_promotion_link_attributions pa
     JOIN referrals r ON r.id=pa.referral_id
     JOIN users promoter ON promoter.id=r.invited_by
     JOIN users referred ON referred.id=r.user_id
     WHERE pa.campaign_id=? AND r.created_at>=? AND r.created_at<?
       AND r.invited_by<>r.user_id
       AND COALESCE(r.self_referral_blocked,0)=0
       AND r.status NOT IN ('fraud','rejected','banned','deleted','reversed')
       AND referred.status NOT IN ('banned','deleted','rejected') AND COALESCE(referred.is_banned,0)=0
       AND promoter.status NOT IN ('banned','deleted','rejected') AND COALESCE(promoter.is_banned,0)=0`,
    [campaign.id, campaign.id, campaign.starts_at, campaign.ends_at]
  );
  return Number(result.affectedRows || 0);
}

export async function trackCampaignChannels(db: typeof pool | PoolConnection = pool) {
  const campaign = await getPromoteCampaign(db);
  if (!campaign || !campaign.starts_at || !campaign.ends_at) return 0;
  const [rows]: any = await db.query(
    `SELECT pr.id campaign_referral_id,pr.campaign_id,pr.promoter_user_id,pr.referred_user_id,
       c.id channel_id,c.chat_id,c.created_at channel_created_at
     FROM publisher_promotion_referrals pr
     JOIN channels c ON c.user_id=pr.referred_user_id
     WHERE pr.campaign_id=? AND pr.status IN ('tracked','pending_channel','pending_validation')
       AND c.created_at>=? AND c.created_at<? AND COALESCE(c.is_deleted,0)=0
     ORDER BY c.created_at,c.id`,
    [campaign.id, campaign.starts_at, campaign.ends_at]
  );
  let tracked = 0;
  for (const row of rows) {
    const identity = normalizeChannelIdentity(row.chat_id);
    if (identity === "telegram:") continue;
    const [event]: any = await db.query(
      `INSERT IGNORE INTO publisher_promotion_channel_events
        (campaign_id,campaign_referral_id,channel_id,normalized_channel_identity,event_type,occurred_at,channel_created_at,idempotency_key,validation_snapshot)
       VALUES(?,?,?,?,'submitted',?,?,?,?)`,
      [row.campaign_id, row.campaign_referral_id, row.channel_id, identity, row.channel_created_at,
        row.channel_created_at, `promote-channel:${row.campaign_id}:${identity}`,
        JSON.stringify({ source: "channels.created_at", historical_reactivation_excluded: true })]
    );
    if (!event.affectedRows) continue;
    await db.query(
      `INSERT IGNORE INTO publisher_promotion_rewards
        (campaign_id,campaign_referral_id,promoter_user_id,referred_user_id,channel_id,status,idempotency_key,eligibility_snapshot)
       VALUES(?,?,?,?,?,'pending_validation',?,?)`,
      [row.campaign_id, row.campaign_referral_id, row.promoter_user_id, row.referred_user_id, row.channel_id,
        `promote-reward:${row.campaign_id}:${row.channel_id}`,
        JSON.stringify({ channel_id: row.channel_id, channel_created_at: row.channel_created_at, identity })]
    );
    await db.query("UPDATE publisher_promotion_referrals SET status='pending_validation' WHERE id=?", [row.campaign_referral_id]);
    tracked += 1;
  }
  return tracked;
}

export async function evaluateCampaignRewards(db: typeof pool | PoolConnection = pool) {
  const campaign = await getPromoteCampaign(db);
  if (!campaign) return { qualified: 0, rejected: 0, manual_review: 0 };
  const [adminRejected]: any = await db.query(
    `UPDATE publisher_promotion_rewards rw
     JOIN channels c ON c.id=rw.channel_id
     SET rw.status='rejected',rw.amount=0,rw.rejection_code='channel_rejected_by_admin'
     WHERE rw.campaign_id=? AND rw.status='pending_validation' AND c.status='rejected'`,
    [campaign.id]
  );
  await db.query(
    `UPDATE publisher_promotion_referrals pr
     JOIN publisher_promotion_rewards rw ON rw.campaign_referral_id=pr.id
     SET pr.status='rejected'
     WHERE pr.campaign_id=? AND rw.status='rejected'`,
    [campaign.id]
  );
  const [rows]: any = await db.query(
    `SELECT rw.*,c.subscriber_count,c.subscribers_fetch_status,c.subscribers_last_success_at,c.status channel_status,
       c.is_deleted,c.under_review,c.settlement_excluded_until,u.status publisher_status,u.is_banned
     FROM publisher_promotion_rewards rw
     JOIN channels c ON c.id=rw.channel_id
     JOIN users u ON u.id=rw.referred_user_id
     WHERE rw.campaign_id=? AND rw.status='pending_validation'
       AND c.status='active' AND COALESCE(c.is_deleted,0)=0
       AND c.marketplace_admin_status='approved' AND COALESCE(c.under_review,0)=0
       AND (c.settlement_excluded_until IS NULL OR c.settlement_excluded_until<=UTC_TIMESTAMP())
       AND c.subscribers_fetch_status='success' AND c.subscribers_last_success_at IS NOT NULL
       AND u.status='active' AND COALESCE(u.is_banned,0)=0`,
    [campaign.id]
  );
  const totals = { qualified: 0, rejected: Number(adminRejected.affectedRows || 0), manual_review: 0 };
  for (const row of rows) {
    const result = rewardTierForAudience(row.subscriber_count || 0);
    const [tiers]: any = result.tier
      ? await db.query("SELECT id FROM publisher_promotion_tiers WHERE campaign_id=? AND minimum_audience=? AND maximum_audience=? LIMIT 1", [campaign.id, result.tier.minimum, result.tier.maximum])
      : [[]];
    const rejection = result.status === "manual_review"
      ? "audience_above_automatic_maximum"
      : result.status === "rejected" ? "audience_below_minimum" : null;
    const [updated]: any = await db.query(
      `UPDATE publisher_promotion_rewards SET status=?,tier_id=?,initial_verified_audience=?,amount=?,rejection_code=?,
         qualified_at=CASE WHEN ?='qualified' THEN NOW(6) ELSE qualified_at END,
         eligibility_snapshot=JSON_OBJECT('channel_id',channel_id,'verified_audience',?,'verified_at',?,'channel_status',?,'reward_amount',?)
       WHERE id=? AND status='pending_validation'`,
      [result.status, tiers[0]?.id || null, row.subscriber_count, result.amount, rejection, result.status,
        row.subscriber_count, row.subscribers_last_success_at, row.channel_status, result.amount, row.id]
    );
    if (updated.affectedRows) {
      await db.query("UPDATE publisher_promotion_referrals SET status=? WHERE id=?", [result.status, row.campaign_referral_id]);
      totals[result.status] += 1;
    }
  }
  return totals;
}

export async function refreshPendingCampaignChannels() {
  const campaign = await getPromoteCampaign();
  if (!campaign) return { attempted: 0, refreshed: 0 };
  const [[setting]]: any = await pool.query("SELECT value FROM settings WHERE `key`='min_subscribers' LIMIT 1");
  const minimum = Math.max(0, Number(setting?.value || 100));
  const [channels]: any = await pool.query(
    `SELECT c.*,u.status publisher_status,u.is_banned publisher_is_banned
     FROM publisher_promotion_rewards rw
     JOIN channels c ON c.id=rw.channel_id
     JOIN users u ON u.id=c.user_id
     WHERE rw.campaign_id=? AND rw.status='pending_validation'
       AND c.status='active' AND c.marketplace_admin_status='approved'
       AND COALESCE(c.is_deleted,0)=0 AND COALESCE(c.under_review,0)=0
       AND c.settlement_excluded_until IS NULL
       AND u.status='active' AND COALESCE(u.is_banned,0)=0
       AND c.subscribers_last_success_at IS NULL
       AND (c.subscribers_next_retry_at IS NULL OR c.subscribers_next_retry_at<=UTC_TIMESTAMP())
     ORDER BY c.id LIMIT 50`,
    [campaign.id]
  );
  let refreshed = 0;
  for (const channel of channels) {
    const result = await refreshSubscriberChannel(channel, minimum);
    if (result.status !== "failed") refreshed += 1;
  }
  return { attempted: channels.length, refreshed };
}

export async function processPromoteCampaign() {
  await pool.query(`UPDATE publisher_promotion_campaigns SET status='active',activated_at=COALESCE(activated_at,NOW(6)) WHERE slug=? AND status='scheduled' AND starts_at<=NOW(6) AND ends_at>NOW(6)`, [PROMOTE_SLUG]);
  const trackedReferrals = await trackCampaignReferrals();
  const trackedChannels = await trackCampaignChannels();
  const refreshedChannels = await refreshPendingCampaignChannels();
  const evaluated = await evaluateCampaignRewards();
  const [closed]: any = await pool.query(
    `UPDATE publisher_promotion_campaigns SET status='closed',closed_at=COALESCE(closed_at,NOW(6))
     WHERE slug=? AND status IN ('scheduled','active','paused') AND ends_at<=NOW(6)`, [PROMOTE_SLUG]
  );
  return { tracked_referrals: trackedReferrals, tracked_channels: trackedChannels, refreshed_channels: refreshedChannels, ...evaluated, closed: Number(closed.affectedRows || 0) };
}

export async function getPromoteSummary(userId: number) {
  const campaign = await getPromoteCampaign();
  if (!campaign) return null;
  if (effectiveStatus(campaign) === "expired") return null;
  const paymentCompleted = campaign.status === "paid" && Boolean(campaign.payment_confirmed_at);
  let [linkRows]: any = await pool.query("SELECT * FROM publisher_promotion_referral_links WHERE campaign_id=? AND promoter_user_id=? LIMIT 1", [campaign.id, userId]);
  let link = linkRows[0];
  if (!link) {
    const token = `PAGX_${crypto.randomBytes(18).toString("base64url")}`;
    await pool.query("INSERT IGNORE INTO publisher_promotion_referral_links (campaign_id,promoter_user_id,token) VALUES(?,?,?)", [campaign.id, userId, token]);
    [linkRows] = await pool.query("SELECT * FROM publisher_promotion_referral_links WHERE campaign_id=? AND promoter_user_id=? LIMIT 1", [campaign.id, userId]);
    link = linkRows[0];
  }
  const [[wallet]]: any = await pool.query("SELECT network,address,saved_at,updated_at FROM publisher_promotion_wallets WHERE campaign_id=? AND user_id=? LIMIT 1", [campaign.id, userId]);
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || process.env.NEXT_PUBLIC_BOT_USERNAME || "Ads_Galaxy_bot";
  const [[stats]]: any = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM publisher_promotion_referrals pr WHERE pr.campaign_id=? AND pr.promoter_user_id=?) total_referrals,
       (SELECT COUNT(*) FROM publisher_promotion_channel_events ce
         JOIN publisher_promotion_referrals pr ON pr.id=ce.campaign_referral_id
         WHERE pr.campaign_id=? AND pr.promoter_user_id=?) channel_referrals,
       (SELECT COUNT(*) FROM publisher_promotion_rewards rw WHERE rw.campaign_id=? AND rw.promoter_user_id=? AND rw.status IN ('pending_channel','pending_validation')) pending_validation,
       (SELECT COUNT(*) FROM publisher_promotion_rewards rw WHERE rw.campaign_id=? AND rw.promoter_user_id=? AND rw.status IN ('qualified','payable','paid')) qualified,
       (SELECT COUNT(*) FROM publisher_promotion_rewards rw WHERE rw.campaign_id=? AND rw.promoter_user_id=? AND rw.status IN ('rejected','reversed')) rejected,
       (SELECT CAST(COALESCE(SUM(rw.amount),0) AS DECIMAL(24,8)) FROM publisher_promotion_rewards rw WHERE rw.campaign_id=? AND rw.promoter_user_id=? AND rw.status IN ('qualified','payable','paid')) campaign_earnings,
       (SELECT CAST(COALESCE(SUM(rw.amount),0) AS DECIMAL(24,8)) FROM publisher_promotion_rewards rw WHERE rw.campaign_id=? AND rw.promoter_user_id=? AND rw.status='paid') paid_amount`,
    [campaign.id,userId,campaign.id,userId,campaign.id,userId,campaign.id,userId,campaign.id,userId,campaign.id,userId,campaign.id,userId]
  );
  return {
    campaign: { status: effectiveStatus(campaign), starts_at: campaign.starts_at, ends_at: campaign.ends_at, wallet_edit_ends_at: campaign.wallet_edit_ends_at, payment_completed: paymentCompleted },
    referral_link: link?.token ? `https://t.me/${botUsername}?start=${link.token}` : null,
    wallet: wallet || null,
    wallet_editable: Boolean(campaign.starts_at)
      && new Date(campaign.starts_at).getTime() <= Date.now()
      && (!campaign.wallet_edit_ends_at || new Date(campaign.wallet_edit_ends_at).getTime() > Date.now()),
    stats: stats || {}, tiers: PROMOTE_TIERS,
  };
}

export async function savePromoteWallet(userId: number, network: string, address: string) {
  const campaign = await getPromoteCampaign();
  if (!campaign) throw new Error("campaign_unavailable");
  if (!campaign.starts_at || new Date(campaign.starts_at).getTime() > Date.now()) throw new Error("wallet_not_open");
  if (campaign.wallet_edit_ends_at && new Date(campaign.wallet_edit_ends_at).getTime() <= Date.now()) throw new Error("wallet_locked");
  const normalizedNetwork = network.toUpperCase();
  const valid = normalizedNetwork === "BEP-20" && /^0x[a-fA-F0-9]{40}$/.test(address);
  if (!valid) throw new Error("invalid_wallet");
  await pool.query(`INSERT INTO publisher_promotion_wallets (campaign_id,user_id,network,address) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE network=VALUES(network),address=VALUES(address),saved_at=NOW(6)`, [campaign.id, userId, normalizedNetwork, address]);
  return getPromoteSummary(userId);
}

export async function activatePromoteCampaign(adminId: number) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[campaign]]: any = await conn.query("SELECT * FROM publisher_promotion_campaigns WHERE slug=? FOR UPDATE", [PROMOTE_SLUG]);
    if (!campaign || campaign.status !== "draft" || campaign.activated_at) throw new Error("campaign_not_draft");
    await conn.query(
      `UPDATE publisher_promotion_campaigns SET status='active',activated_at=UTC_TIMESTAMP(6),starts_at=UTC_TIMESTAMP(6),
         ends_at=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 3 DAY),activated_by_admin_id=? WHERE id=?`, [adminId, campaign.id]
    );
    await audit(conn, { campaignId: campaign.id, actorType: "admin", actorId: adminId, action: "activated", entityType: "campaign", entityId: campaign.id });
    await conn.commit();
    return getPromoteCampaign();
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}

export async function setPromoteCampaignStatus(status: "paused" | "active" | "closed" | "payout_review", adminId: number) {
  const campaign = await getPromoteCampaign();
  if (!campaign?.activated_at) throw new Error("campaign_not_activated");
  if (status === "active" && campaign.status !== "paused") throw new Error("campaign_not_paused");
  if (status === "active" && new Date(campaign.ends_at).getTime() <= Date.now()) throw new Error("campaign_window_ended");
  await pool.query(
    `UPDATE publisher_promotion_campaigns SET status=?,paused_at=CASE WHEN ?='paused' THEN UTC_TIMESTAMP(6) ELSE paused_at END,
       closed_at=CASE WHEN ?='closed' THEN UTC_TIMESTAMP(6) ELSE closed_at END,
       payout_review_at=CASE WHEN ?='payout_review' THEN UTC_TIMESTAMP(6) ELSE payout_review_at END WHERE id=?`,
    [status, status, status, status, campaign.id]
  );
  await audit(pool, { campaignId: campaign.id, actorType: "admin", actorId: adminId, action: `status_${status}`, entityType: "campaign", entityId: campaign.id });
  return getPromoteCampaign();
}

export async function createPayoutBatch(adminId: number) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[campaign]]: any = await conn.query("SELECT * FROM publisher_promotion_campaigns WHERE slug=? FOR UPDATE", [PROMOTE_SLUG]);
    if (!campaign || !["closed", "payout_review"].includes(campaign.status)) throw new Error("campaign_not_closed");
    await conn.query(
      `UPDATE publisher_promotion_rewards rw
       JOIN channels c ON c.id=rw.channel_id
       JOIN users u ON u.id=rw.referred_user_id
       SET rw.status='rejected',rw.amount=0,rw.rejection_code='channel_no_longer_eligible'
       WHERE rw.campaign_id=? AND rw.status='qualified'
         AND (c.status<>'active' OR COALESCE(c.is_deleted,0)=1
           OR COALESCE(c.marketplace_admin_status,'')<>'approved' OR COALESCE(c.under_review,0)=1
           OR c.settlement_excluded_until>UTC_TIMESTAMP()
           OR COALESCE(c.subscribers_fetch_status,'')<>'success' OR c.subscribers_last_success_at IS NULL
           OR u.status<>'active' OR COALESCE(u.is_banned,0)=1
           OR COALESCE(c.subscriber_count,0)<2000)`,
      [campaign.id]
    );
    await conn.query(
      `UPDATE publisher_promotion_rewards rw
       JOIN channels c ON c.id=rw.channel_id
       LEFT JOIN publisher_promotion_wallets w ON w.campaign_id=rw.campaign_id AND w.user_id=rw.promoter_user_id
       JOIN users u ON u.id=rw.referred_user_id
       SET rw.final_verified_audience=c.subscriber_count,
         rw.amount=LEAST(rw.amount,COALESCE(
           (SELECT t.reward_amount FROM publisher_promotion_tiers t WHERE t.campaign_id=rw.campaign_id AND c.subscriber_count BETWEEN t.minimum_audience AND t.maximum_audience LIMIT 1),
           (SELECT t.reward_amount FROM publisher_promotion_tiers t WHERE t.campaign_id=rw.campaign_id ORDER BY t.minimum_audience LIMIT 1)
         )),
         rw.status=CASE WHEN w.id IS NULL THEN 'manual_review' WHEN c.subscriber_count>20000000 THEN 'manual_review' ELSE 'payable' END,
         rw.rejection_code=CASE WHEN w.id IS NULL THEN 'missing_payout_wallet' WHEN c.subscriber_count>20000000 THEN 'audience_above_automatic_maximum' ELSE NULL END,
         rw.payable_at=CASE WHEN w.id IS NOT NULL AND c.subscriber_count<=20000000 THEN UTC_TIMESTAMP(6) ELSE NULL END,
         rw.eligibility_snapshot=JSON_SET(COALESCE(rw.eligibility_snapshot,JSON_OBJECT()),'$.payout_network',w.network,'$.payout_wallet',w.address)
       WHERE rw.campaign_id=? AND rw.status='qualified'
         AND c.status='active' AND COALESCE(c.is_deleted,0)=0
         AND c.marketplace_admin_status='approved' AND COALESCE(c.under_review,0)=0
         AND (c.settlement_excluded_until IS NULL OR c.settlement_excluded_until<=UTC_TIMESTAMP())
         AND u.status='active' AND COALESCE(u.is_banned,0)=0
         AND c.subscriber_count>=2000 AND c.subscribers_fetch_status='success'
         AND c.subscribers_last_success_at>rw.qualified_at`, [campaign.id]
    );
    const [[totals]]: any = await conn.query("SELECT COUNT(*) reward_count,CAST(COALESCE(SUM(amount),0) AS DECIMAL(24,8)) total_amount FROM publisher_promotion_rewards WHERE campaign_id=? AND status='payable'", [campaign.id]);
    const key = `promote-payout:${campaign.id}:final`;
    await conn.query(
      `INSERT INTO publisher_promotion_payout_batches (campaign_id,status,reward_count,total_amount,idempotency_key,created_by_admin_id,approved_by_admin_id,approved_at)
       VALUES(?,'approved',?,?,?,?,UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE id=id`,
      [campaign.id, totals.reward_count, totals.total_amount, key, adminId, adminId]
    );
    await conn.query("UPDATE publisher_promotion_campaigns SET status='payout_review',payout_review_at=COALESCE(payout_review_at,UTC_TIMESTAMP(6)),payout_approved_by_admin_id=? WHERE id=?", [adminId, campaign.id]);
    await audit(conn, { campaignId: campaign.id, actorType: "admin", actorId: adminId, action: "payout_batch_approved", entityType: "campaign", entityId: campaign.id, metadata: totals });
    await conn.commit();
    return totals;
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}

export async function executePayoutBatch(adminId: number, paymentReference: string, confirmedAmount: string) {
  const reference = String(paymentReference || "").trim();
  if (!reference) throw new Error("payment_reference_required");
  if (!/^\d+(\.\d{1,8})?$/.test(String(confirmedAmount || ""))) throw new Error("invalid_confirmed_amount");
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[campaign]]: any = await conn.query("SELECT * FROM publisher_promotion_campaigns WHERE slug=? FOR UPDATE", [PROMOTE_SLUG]);
    const [[batch]]: any = await conn.query("SELECT * FROM publisher_promotion_payout_batches WHERE campaign_id=? AND status='approved' FOR UPDATE", [campaign?.id]);
    if (!campaign || campaign.status !== "payout_review" || !batch) throw new Error("payout_not_approved");
    const [[payableTotals]]: any = await conn.query(
      "SELECT COUNT(*) reward_count,CAST(COALESCE(SUM(amount),0) AS DECIMAL(24,8)) total_amount FROM publisher_promotion_rewards WHERE campaign_id=? AND status='payable'",
      [campaign.id]
    );
    if (Number(payableTotals.total_amount) !== Number(confirmedAmount)) throw new Error("confirmed_amount_mismatch");
    await conn.query(
      `UPDATE publisher_promotion_rewards rw
       JOIN channels c ON c.id=rw.channel_id
       JOIN users u ON u.id=rw.referred_user_id
       SET rw.status='rejected',rw.amount=0,rw.rejection_code='channel_no_longer_eligible'
       WHERE rw.campaign_id=? AND rw.status='payable'
         AND (c.status<>'active' OR COALESCE(c.is_deleted,0)=1
           OR COALESCE(c.marketplace_admin_status,'')<>'approved' OR COALESCE(c.under_review,0)=1
           OR c.settlement_excluded_until>UTC_TIMESTAMP()
           OR COALESCE(c.subscribers_fetch_status,'')<>'success' OR c.subscribers_last_success_at IS NULL
           OR u.status<>'active' OR COALESCE(u.is_banned,0)=1
           OR COALESCE(c.subscriber_count,0)<2000)`,
      [campaign.id]
    );
    const [rewards]: any = await conn.query(
      `SELECT rw.*,w.network payout_network,w.address payout_wallet
       FROM publisher_promotion_rewards rw
       JOIN publisher_promotion_wallets w ON w.campaign_id=rw.campaign_id AND w.user_id=rw.promoter_user_id
       JOIN channels c ON c.id=rw.channel_id
       JOIN users u ON u.id=rw.referred_user_id
       WHERE rw.campaign_id=? AND rw.status='payable' AND w.network='BEP-20'
         AND c.status='active' AND COALESCE(c.is_deleted,0)=0
         AND c.marketplace_admin_status='approved' AND COALESCE(c.under_review,0)=0
         AND (c.settlement_excluded_until IS NULL OR c.settlement_excluded_until<=UTC_TIMESTAMP())
         AND c.subscribers_fetch_status='success' AND c.subscribers_last_success_at IS NOT NULL
         AND c.subscriber_count>=2000
         AND u.status='active' AND COALESCE(u.is_banned,0)=0
       ORDER BY rw.id FOR UPDATE`, [campaign.id]
    );
    for (const reward of rewards) {
      await conn.query(
        `UPDATE publisher_promotion_rewards
         SET status='paid',paid_at=UTC_TIMESTAMP(6),financial_ledger_id=NULL,
           eligibility_snapshot=JSON_SET(COALESCE(eligibility_snapshot,JSON_OBJECT()),'$.payout_network',?,'$.payout_wallet',?,'$.payout_mode','externally_confirmed','$.payment_reference',?)
         WHERE id=? AND status='payable'`,
        [reward.payout_network, reward.payout_wallet, reference, reward.id]
      );
    }
    await conn.query("UPDATE publisher_promotion_payout_batches SET status='executed',executed_by_admin_id=?,executed_at=UTC_TIMESTAMP(6),reconciled_at=UTC_TIMESTAMP(6),payment_reference=?,confirmed_amount=? WHERE id=?", [adminId, reference, confirmedAmount, batch.id]);
    await conn.query("UPDATE publisher_promotion_campaigns SET status='paid',paid_at=UTC_TIMESTAMP(6),payment_confirmation_reference=?,payment_confirmed_amount=?,payment_confirmed_by_admin_id=?,payment_confirmed_at=UTC_TIMESTAMP(6),completion_expires_at=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 12 HOUR) WHERE id=?", [reference, confirmedAmount, adminId, campaign.id]);
    await audit(conn, { campaignId: campaign.id, actorType: "admin", actorId: adminId, action: "payout_externally_confirmed", entityType: "payout_batch", entityId: batch.id, metadata: { payment_reference: reference, confirmed_amount: confirmedAmount, reward_count: rewards.length } });
    await conn.commit();
    return { paid: rewards.length, batch_id: batch.id };
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}
