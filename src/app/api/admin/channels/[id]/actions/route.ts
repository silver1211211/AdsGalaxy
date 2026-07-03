import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { checkChannelHealth, markChannelHealthSuccess, autoPauseChannel } from "@/lib/channelLifecycle";
import { clearPrivateTrackingAssignment } from "@/lib/privateChannelTrackingOnboarding";
import { getChannelPrivacySchema } from "@/lib/channelPrivacy";
import { refreshChannelViews } from "@/lib/channelAdminViewRefresh";
import { settleChannelCampaigns } from "@/lib/channelSettlement";
import { getPublisherQuality } from "@/lib/publisherQuality";
import { notifyChannelApproved, notifyChannelRejected, notifyChannelRemoved } from "@/lib/publisherNotifications";
import { sendChannelWelcomePostIfNeeded } from "@/lib/channelWelcomePost";

type ChannelRow = RowDataPacket & {
  id: number; user_id: number; status: string; is_deleted: number;
  chat_id: string; publisher_trust_score: number | string;
  trust_score_frozen_until: Date | null; under_review: number;
  settlement_excluded_until: Date | null; publisher_status: string; publisher_is_banned: number;
  title: string; telegram_id: string | number | null;
};

const DANGEROUS = new Set(["delete", "adjust_trust", "reinstate", "settlement", "exclude_settlement", "include_settlement", "mark_false_positive"]);
const REASON_REQUIRED = new Set(["adjust_trust", "reinstate", "exclude_settlement", "mark_false_positive"]);

async function audit(adminId: number | undefined, channel: ChannelRow, action: string, reason: string, oldValue: unknown, newValue: unknown) {
  await pool.query(
    `INSERT INTO channel_admin_action_audits(admin_id,action,channel_id,publisher_id,old_value,new_value,reason)
     VALUES (?,?,?,?,?,?,?)`,
    [adminId || null, action, channel.id, channel.user_id, JSON.stringify(oldValue), JSON.stringify(newValue), reason]
  );
  await recordAdminActionAudit({ adminId, action: `channel_${action}`, entityType: "channel", entityId: channel.id, reason, metadata: { publisher_id: channel.user_id, old_value: oldValue, new_value: newValue } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await request.json() as { action?: string; reason?: string; value?: unknown; duration_hours?: unknown; fraud_event_id?: unknown };
  const action = body.action === "activate" ? "resume" : body.action || "";
  const permission = DANGEROUS.has(action) ? "dangerous" : "operate";
  const { admin, response } = await requireAdminPermission(permission);
  if (response) return response;
  const channelId = Number((await params).id);
  const reason = String(body.reason || "").trim();
  if (!Number.isInteger(channelId) || channelId <= 0) return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
  if (REASON_REQUIRED.has(action) && reason.length < 3) return NextResponse.json({ error: "A reason is required" }, { status: 400 });

  const [rows] = await pool.query<ChannelRow[]>(
    `SELECT ch.id,ch.user_id,ch.status,ch.is_deleted,ch.chat_id,ch.publisher_trust_score,
       ch.trust_score_frozen_until,ch.under_review,ch.settlement_excluded_until,ch.title,
       u.status publisher_status,u.is_banned publisher_is_banned,u.telegram_id
     FROM channels ch JOIN users u ON u.id=ch.user_id WHERE ch.id=? LIMIT 1`, [channelId]
  );
  const channel = rows[0];
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  let result: unknown = { success: true };
  let oldValue: unknown = { status: channel.status };
  let newValue: unknown = oldValue;

  if (action === "pause") {
    await pool.query("UPDATE channels SET status='paused',paused_reason='Paused by admin control center' WHERE id=?", [channelId]);
    newValue = { status: "paused" };
  } else if (action === "resume") {
    // The status<>'active' guard makes this a compare-and-swap: a retried or
    // double-submitted request only ever sees affectedRows=0 the second time,
    // so the approval notification and welcome post never fire twice.
    const [update] = await pool.query<ResultSetHeader>(
      "UPDATE channels SET status='active',is_deleted=FALSE,paused_reason=NULL,failure_reason=NULL,reactivated_at=NOW() WHERE id=? AND status<>'active'",
      [channelId]
    );
    newValue = { status: "active" };
    if (update.affectedRows > 0) {
      await notifyChannelApproved(channel.telegram_id, channelId, channel.title);
    }
    await sendChannelWelcomePostIfNeeded(channelId, channel.chat_id);
  } else if (action === "reject") {
    const [update] = await pool.query<ResultSetHeader>(
      "UPDATE channels SET status='rejected',paused_reason='Rejected by admin control center' WHERE id=? AND status<>'rejected'",
      [channelId]
    );
    newValue = { status: "rejected" };
    if (update.affectedRows > 0) {
      await notifyChannelRejected(channel.telegram_id, channelId, channel.title);
    }
  } else if (action === "delete") {
    const [update] = await pool.query<ResultSetHeader>(
      "UPDATE channels SET status='deleted',is_deleted=TRUE,paused_reason=? WHERE id=? AND is_deleted=FALSE",
      [reason, channelId]
    );
    await clearPrivateTrackingAssignment(channelId, await getChannelPrivacySchema());
    newValue = { status: "deleted", is_deleted: true };
    if (update.affectedRows > 0) {
      await notifyChannelRemoved(channel.telegram_id, channelId, channel.title);
    }
  } else if (action === "mark_review" || action === "clear_review") {
    const underReview = action === "mark_review" ? 1 : 0;
    oldValue = { under_review: Boolean(channel.under_review) };
    newValue = { under_review: Boolean(underReview) };
    await pool.query("UPDATE channels SET under_review=? WHERE id=?", [underReview, channelId]);
  } else if (action === "health_check") {
    const health = await checkChannelHealth({ id: channelId, chat_id: channel.chat_id });
    if (health.ok) await markChannelHealthSuccess(channelId);
    else await autoPauseChannel(channelId, health);
    oldValue = { health_status: "requested" };
    newValue = health;
    result = { success: true, health };
  } else if (action === "view_refresh") {
    result = { success: true, refresh: await refreshChannelViews(channelId) };
    oldValue = { operation: "view_refresh" };
    newValue = result;
  } else if (action === "settlement") {
    result = { success: true, settlement: await settleChannelCampaigns({ channelId }) };
    oldValue = { operation: "settlement" };
    newValue = result;
  } else if (action === "adjust_trust") {
    const score = Number(body.value);
    if (!Number.isFinite(score) || score < -100 || score > 100) return NextResponse.json({ error: "Trust score must be between -100 and 100" }, { status: 400 });
    oldValue = { trust_score: Number(channel.publisher_trust_score) };
    newValue = { trust_score: score };
    await pool.query("UPDATE channels SET publisher_trust_score=? WHERE id=?", [score, channelId]);
    await pool.query("UPDATE users SET publisher_trust_score=(SELECT AVG(publisher_trust_score) FROM channels WHERE user_id=? AND is_deleted=FALSE) WHERE id=?", [channel.user_id, channel.user_id]);
    await getPublisherQuality(channelId);
  } else if (action === "freeze_trust") {
    const hours = Math.min(720, Math.max(1, Number(body.duration_hours) || 24));
    oldValue = { frozen_until: channel.trust_score_frozen_until };
    await pool.query("UPDATE channels SET trust_score_frozen_until=DATE_ADD(NOW(),INTERVAL ? HOUR) WHERE id=?", [hours, channelId]);
    newValue = { duration_hours: hours };
  } else if (action === "unfreeze_trust") {
    oldValue = { frozen_until: channel.trust_score_frozen_until };
    await pool.query("UPDATE channels SET trust_score_frozen_until=NULL WHERE id=?", [channelId]);
    newValue = { frozen_until: null };
  } else if (action === "mark_false_positive") {
    const eventId = Number(body.fraud_event_id);
    const [update] = await pool.query<ResultSetHeader>(
      `UPDATE channel_fraud_events SET false_positive_at=NOW(),false_positive_by=?,false_positive_reason=?
       WHERE id=COALESCE(NULLIF(?,0),(SELECT event_id FROM (SELECT id event_id FROM channel_fraud_events WHERE channel_id=? ORDER BY created_at DESC LIMIT 1) latest)) AND channel_id=?`,
      [admin?.id || null, reason, eventId || 0, channelId, channelId]
    );
    if (!update.affectedRows) return NextResponse.json({ error: "Fraud event not found" }, { status: 404 });
    oldValue = { fraud_event_id: eventId || "latest", false_positive: false };
    newValue = { fraud_event_id: eventId || "latest", false_positive: true };
  } else if (action === "reinstate") {
    await pool.query("UPDATE users SET status='active',is_banned=0,banned_at=NULL,ban_reason=NULL,publisher_trust_score=60 WHERE id=?", [channel.user_id]);
    await pool.query("UPDATE channels SET status='active',is_deleted=FALSE,paused_reason=NULL,under_review=0,publisher_trust_score=60,trust_score_frozen_until=DATE_ADD(NOW(),INTERVAL 24 HOUR),reactivated_at=NOW() WHERE user_id=? AND is_deleted=FALSE", [channel.user_id]);
    oldValue = { publisher_status: channel.publisher_status, publisher_is_banned: Boolean(channel.publisher_is_banned), channel_status: channel.status };
    newValue = { publisher_status: "active", publisher_is_banned: false, channel_status: "active", publisher_trust_score: 60, trust_enforcement_frozen_hours: 24 };
  } else if (action === "exclude_settlement") {
    const hours = Math.min(720, Math.max(1, Number(body.duration_hours) || 24));
    oldValue = { excluded_until: channel.settlement_excluded_until };
    await pool.query("UPDATE channels SET settlement_excluded_until=DATE_ADD(NOW(),INTERVAL ? HOUR),settlement_exclusion_reason=? WHERE id=?", [hours, reason, channelId]);
    newValue = { duration_hours: hours, reason };
  } else if (action === "include_settlement") {
    oldValue = { excluded_until: channel.settlement_excluded_until };
    await pool.query("UPDATE channels SET settlement_excluded_until=NULL,settlement_exclusion_reason=NULL WHERE id=?", [channelId]);
    newValue = { excluded_until: null };
  } else {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  await audit(admin?.id, channel, action, reason || `admin_${action}`, oldValue, newValue);
  return NextResponse.json(result);
}
