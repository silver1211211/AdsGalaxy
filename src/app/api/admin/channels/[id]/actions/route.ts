import { recordChannelStatusTransitionAudit } from "@/lib/channelStatusAudit";
import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { verifyTelegramChannelAccess } from "@/lib/telegramChannelAccess";
import { clearPrivateTrackingAssignment, onboardPrivateChannelTracking, privateTrackingFailureMessage } from "@/lib/privateChannelTrackingOnboarding";
import { getChannelPrivacySchema } from "@/lib/channelPrivacy";
import { refreshChannelViews } from "@/lib/channelAdminViewRefresh";
import { settleChannelCampaigns } from "@/lib/channelSettlement";
import { getPublisherQuality } from "@/lib/publisherQuality";
import { notifyChannelApproved, notifyChannelRejected, notifyChannelRemoved, notifyChannelPaused } from "@/lib/publisherNotifications";
import { verifyAndStoreChannelIdentity } from "@/lib/channelTelegramIdentity";
import { getPublicChannelApprovalEligibility } from "@/lib/publicChannelApproval";
import { evaluateUnifiedChannelEligibility } from "@/lib/channelEligibility";
import { enqueueAssetNotification } from "@/lib/platformNotifications";
import { mainCampaignScopeSql } from "@/lib/silverCampaignControl";

type ChannelRow = RowDataPacket & {
  id: number; user_id: number; status: string; is_deleted: number;
  chat_id: string; username: string | null; channel_type: "public" | "private"; publisher_trust_score: number | string;
  trust_score_frozen_until: Date | null; under_review: number;
  settlement_excluded_until: Date | null; publisher_status: string; publisher_is_banned: number;
  title: string; telegram_id: string | number | null;
};

const DANGEROUS = new Set(["delete", "adjust_trust", "reinstate", "settlement", "exclude_settlement", "include_settlement", "mark_false_positive"]);
const REASON_REQUIRED = new Set(["adjust_trust", "reinstate", "exclude_settlement", "mark_false_positive"]);

async function channelDeletionReadiness(channelId: number, postId?: number) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT cp.id, cp.campaign_id, cp.message_id, cp.status, cp.created_at,
       COALESCE(cp.delivery_confirmed_at, cp.created_at) deletion_clock_started_at,
       cp.views, cp.settled_views, cp.settled_clicks, cp.deleted_at, cp.delivery_failed_at,
       c.type campaign_type,
       (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id = cp.id) click_count,
       (SELECT COUNT(*) FROM channel_advertiser_debits cad WHERE cad.post_id = cp.id AND cad.publisher_status <> 'settled') pending_fast_debit_rows,
       CASE
         WHEN cp.status <> 'active' THEN 'not_active'
         WHEN cp.deleted_at IS NOT NULL THEN 'already_deleted'
         WHEN cp.delivery_failed_at IS NOT NULL THEN 'delivery_failed'
         WHEN cp.message_id IS NULL OR TRIM(cp.message_id) = '' THEN 'missing_message_id'
         WHEN COALESCE(cp.delivery_confirmed_at, cp.created_at) > DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 'not_expired_24h'
         WHEN c.type = 'views' AND COALESCE(cp.views,0) > COALESCE(cp.settled_views,0)
           + COALESCE((SELECT SUM(cvw.waived_views) FROM channel_view_waivers cvw WHERE cvw.post_id=cp.id),0)
           THEN 'unsettled_views'
         WHEN c.type = 'clicks' AND (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id = cp.id) > COALESCE(cp.settled_clicks,0) THEN 'unsettled_clicks'
         WHEN EXISTS (SELECT 1 FROM channel_advertiser_debits cad WHERE cad.post_id = cp.id AND cad.publisher_status <> 'settled') THEN 'pending_publisher_settlement'
         ELSE 'ready'
       END readiness
     FROM campaign_posts cp
     JOIN campaigns c ON c.id = cp.campaign_id
     WHERE cp.channel_id = ?
       AND ${mainCampaignScopeSql("c")}
       AND (? IS NULL OR cp.id = ?)
     ORDER BY cp.id DESC
     LIMIT 50`,
    [channelId, postId || null, postId || null]
  );
  const ready = rows.filter((row) => row.readiness === "ready").length;
  return {
    checked: rows.length,
    ready,
    blocked: rows.length - ready,
    posts: rows,
    note: "Read-only readiness check; no fake views, billing, settlement, or Telegram deletion was performed.",
  };
}

async function audit(adminId: number | undefined, channel: ChannelRow, action: string, reason: string, oldValue: unknown, newValue: unknown) {
  await pool.query(
    `INSERT INTO channel_admin_action_audits(admin_id,action,channel_id,publisher_id,old_value,new_value,reason)
     VALUES (?,?,?,?,?,?,?)`,
    [adminId || null, action, channel.id, channel.user_id, JSON.stringify(oldValue), JSON.stringify(newValue), reason]
  );
  await recordAdminActionAudit({ adminId, action: `channel_${action}`, entityType: "channel", entityId: channel.id, reason, metadata: { publisher_id: channel.user_id, old_value: oldValue, new_value: newValue } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await request.json() as { action?: string; reason?: string; value?: unknown; duration_hours?: unknown; fraud_event_id?: unknown; post_id?: unknown };
  const action = body.action === "activate" ? "resume" : body.action || "";
  const permission = DANGEROUS.has(action) ? "dangerous" : "operate";
  const { admin, response } = await requireAdminPermission(permission);
  if (response) return response;
  if (action === "reject") return NextResponse.json({ error: "MODERATION_REASON_REQUIRED", code: "MODERATION_REASON_REQUIRED" }, { status: 400 });
  const channelId = Number((await params).id);
  const reason = String(body.reason || "").trim();
  if (!Number.isInteger(channelId) || channelId <= 0) return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
  if (REASON_REQUIRED.has(action) && reason.length < 3) return NextResponse.json({ error: "A reason is required" }, { status: 400 });

  const [rows] = await pool.query<ChannelRow[]>(
    `SELECT ch.id,ch.user_id,ch.status,ch.is_deleted,ch.chat_id,ch.username,ch.channel_type,ch.publisher_trust_score,
       ch.trust_score_frozen_until,ch.under_review,ch.marketplace_admin_status,ch.settlement_excluded_until,ch.title,
       u.status publisher_status,u.is_banned publisher_is_banned,u.telegram_id
     FROM channels ch JOIN users u ON u.id=ch.user_id WHERE ch.id=? LIMIT 1`, [channelId]
  );
  const channel = rows[0];
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
  let result: unknown = { success: true };
  let oldValue: unknown = { status: channel.status };
  let newValue: unknown = oldValue;

  if (action === "pause") {
    const [update] = await pool.query<ResultSetHeader>(
      "UPDATE channels SET status='paused',paused_reason='Paused by admin control center',paused_by_actor='admin',admin_paused_at=UTC_TIMESTAMP(6),notification_state_version=notification_state_version+1,telegram_access_version=COALESCE(telegram_access_version,0)+1 WHERE id=? AND status<>'paused'", [channelId]);
    newValue = { status: "paused" };
    if (update.affectedRows > 0) {
      await recordChannelStatusTransitionAudit(pool, {
        channelId,
        telegramChatId: channel.chat_id,
        previousStatus: String(channel.status),
        newStatus: "paused",
        sourceWorker: "admin_channel_actions",
        reasonCode: "admin_manual_pause",
        reasonText: reason || "Paused by admin control center",
        evidenceClassification: "manual",
        actorType: "admin",
        actorId: admin?.id || null,
        transitionIntent: "manual",
        notificationGenerated: true,
      });
      const [[version]] = await pool.query<Array<RowDataPacket & { notification_state_version: number }>>(
        "SELECT notification_state_version FROM channels WHERE id=?", [channelId]);
      await notifyChannelPaused(channel.telegram_id, channelId, channel.title, Number(version?.notification_state_version || 1));
    }
    } else if (action === "resume") {
      if (channel.channel_type === "public" && channel.status === "active" && !Boolean(channel.is_deleted) && channel.marketplace_admin_status !== "rejected") {
        return NextResponse.json({ success: true, already_approved: true });
      }
      if (Boolean(channel.is_deleted) || channel.status === "deleted") {
        return NextResponse.json({ error: "Deleted channels cannot be resumed.", code: "CHANNEL_DELETED" }, { status: 409 });
      }
      if (channel.status === "rejected" || channel.marketplace_admin_status === "rejected") {
        return NextResponse.json({ error: "Rejected channels require an explicit moderation reversal before activation.", code: "CHANNEL_REJECTED" }, { status: 409 });
      }
      const preGate = evaluateUnifiedChannelEligibility({
        ...channel,
        context: channel.status === "pending" ? "admin_approval" : "admin_resume",
        live_verification_confirmed: true,
      });
      if (!preGate.eligible && preGate.blockingDimension !== "telegramIdentityVerification") {
        return NextResponse.json({ error: preGate.reason || "Channel is not eligible for activation.", code: preGate.code }, { status: 409 });
      }
      if (channel.channel_type === "public") {
        const eligibility = await getPublicChannelApprovalEligibility(channelId);
        if (!eligibility.eligible) return NextResponse.json({ error: eligibility.reason }, { status: 409 });
      }
      if (channel.channel_type === "public" && channel.status !== "pending") {
      let identity;
      try {
        identity = await verifyAndStoreChannelIdentity({
          channelId,
          chatId: channel.chat_id,
          username: channel.username,
          source: "admin_resume",
        });
      } catch (error: any) {
        const message = error instanceof Error ? error.message : "Telegram channel verification failed.";
        return NextResponse.json({
          error: message,
          code: error?.code && ["temporarily_rate_limited", "temporary_telegram_error"].includes(error.code)
            ? "TEMPORARILY_UNVERIFIED"
            : error?.code === "identity_conflict"
              ? "IDENTITY_CONFLICT"
              : "CHANNEL_VERIFICATION_BLOCKED",
          classification: error?.code || null,
          retry_at: error?.retryAfterSeconds ? new Date(Date.now() + error.retryAfterSeconds * 1000).toISOString() : null,
        }, { status: 409 });
      }
      channel.chat_id = identity.chatId;
      channel.username = identity.username;
      }
      let confirmedPrivateTracking: number | null = null;
      if (channel.channel_type === "private") {
        const tracking = await onboardPrivateChannelTracking({
          channelId,
          chatId: channel.chat_id,
          channelType: "private",
          schema: await getChannelPrivacySchema(),
        });
        if (tracking.status !== "active") {
          const reason = tracking.status === "pending_manual" ? tracking.reason : "tracking_not_active";
          return NextResponse.json({
            error: privateTrackingFailureMessage(reason),
            code: reason,
            retry_after_seconds: tracking.status === "pending_manual" ? tracking.retryAfterSeconds ?? null : null,
            tracking,
          }, { status: 409 });
        }
        confirmedPrivateTracking = tracking.tracking_account;
      }
    const conn = await pool.getConnection();
    let resumeAffected = 0;
    let resumeNewVersion = 1;
    try {
      await conn.beginTransaction();
      const [freshRows] = await conn.query<RowDataPacket[]>(
        `SELECT c.id, c.user_id, c.status, c.is_deleted, c.under_review, c.marketplace_admin_status,
                  c.channel_type, c.chat_id, c.tracking_account, c.tracking_account_status, c.tracking_account_member_status,
                c.subscriber_count, c.paused_by_actor, c.admin_paused_at, c.publisher_paused_at,
                c.monetization_paused_reason, c.below_minimum_review_required,
                c.settlement_excluded_until, c.automation_suspension_status,
                c.automation_suspended_until, c.revenue_protection_status,
                c.telegram_access_version,
                u.status AS publisher_status, COALESCE(u.is_banned, 0) AS publisher_is_banned
         FROM channels c
         JOIN users u ON u.id = c.user_id
         WHERE c.id = ? FOR UPDATE`,
        [channelId],
      );
      const fresh = freshRows[0];
      if (!fresh || Boolean(fresh.is_deleted) || fresh.status === "deleted") {
        await conn.rollback();
        return NextResponse.json({ error: "Deleted channels cannot be resumed.", code: "CHANNEL_DELETED" }, { status: 409 });
      }
      if (channel.channel_type === "private") {
        const sameMembership = fresh.channel_type === "private" && String(fresh.chat_id) === String(channel.chat_id)
          && Number(fresh.tracking_account) === confirmedPrivateTracking && fresh.tracking_account_status === "active"
          && ["member", "already_member"].includes(String(fresh.tracking_account_member_status));
        if (!sameMembership) {
          await conn.rollback();
          return NextResponse.json({ error: "Private channel membership changed during approval; retry manually.", code: "TRACKING_STATE_CHANGED" }, { status: 409 });
        }
        if (fresh.status === "active" && fresh.marketplace_admin_status !== "rejected") {
          await conn.rollback();
          return NextResponse.json({ success: true, already_approved: true });
        }
        if (channel.status === "pending" && fresh.status !== "pending") {
          await conn.rollback();
          return NextResponse.json({ error: "Channel changed during approval; review its current status.", code: "CHANNEL_STATUS_CHANGED" }, { status: 409 });
        }
      }
      if (channel.channel_type === "public" && channel.status === "pending" && fresh.status !== "pending") {
        await conn.rollback();
        return fresh.status === "active" && fresh.marketplace_admin_status !== "rejected"
          ? NextResponse.json({ success: true, already_approved: true })
          : NextResponse.json({ error: "Channel changed during approval; review its current status.", code: "CHANNEL_STATUS_CHANGED" }, { status: 409 });
      }
      if (fresh.status === "rejected" || fresh.marketplace_admin_status === "rejected") {
        await conn.rollback();
        return NextResponse.json({ error: "Rejected channels require an explicit moderation reversal before activation.", code: "CHANNEL_REJECTED" }, { status: 409 });
      }
      if ((channel.channel_type === "public" || channel.channel_type === "private") && channel.status === "pending" && (
        Boolean(fresh.under_review) || fresh.marketplace_admin_status === "rejected" ||
        fresh.subscriber_count == null || Number(fresh.subscriber_count) < 100 ||
        fresh.paused_by_actor === "admin" || fresh.paused_by_actor === "publisher" ||
        Boolean(fresh.admin_paused_at) || Boolean(fresh.publisher_paused_at) ||
        (fresh.settlement_excluded_until && new Date(String(fresh.settlement_excluded_until)) > new Date()) ||
        (fresh.automation_suspension_status && fresh.automation_suspension_status !== "active") ||
        (fresh.automation_suspended_until && new Date(String(fresh.automation_suspended_until)) > new Date()) ||
        (fresh.revenue_protection_status && fresh.revenue_protection_status !== "normal")
      )) {
        await conn.rollback();
        return NextResponse.json({ error: "Channel eligibility changed during approval.", code: "CHANNEL_ELIGIBILITY_CHANGED" }, { status: 409 });
      }
      if (channel.channel_type === "public" && channel.status === "pending") {
        const lockedEligibility = await getPublicChannelApprovalEligibility(channelId, conn);
        if (!lockedEligibility.eligible) {
          await conn.rollback();
          return NextResponse.json({ error: lockedEligibility.reason, code: "CHANNEL_ELIGIBILITY_CHANGED" }, { status: 409 });
        }
      }
      if (Boolean(fresh.publisher_is_banned) || fresh.publisher_status !== "active") {
        await conn.rollback();
        return NextResponse.json({ error: "Channel owner account is not eligible for channel activation.", code: "PUBLISHER_INELIGIBLE" }, { status: 409 });
      }
      if (fresh.subscriber_count !== null && Number(fresh.subscriber_count) < 100) {
        await conn.rollback();
        return NextResponse.json({ error: "Channel subscriber count is below the minimum threshold of 100 subscribers.", code: "BELOW_MINIMUM_SUBSCRIBERS" }, { status: 409 });
      }
      if (fresh.monetization_paused_reason === "below_minimum" || Boolean(fresh.below_minimum_review_required)) {
        await conn.rollback();
        return NextResponse.json({ error: "Channel is below the minimum subscriber threshold.", code: "BELOW_MINIMUM_REVIEW" }, { status: 409 });
      }

      resumeNewVersion = Number(fresh.telegram_access_version || 0) + 1;
      const [update] = await conn.query<ResultSetHeader>(
        `UPDATE channels
         SET status='active',
             is_deleted=FALSE,
             paused_reason=NULL,
             paused_by_actor=NULL,
             admin_paused_at=NULL,
             publisher_paused_at=NULL,
             failure_reason=NULL,
             suggested_fix=NULL,
             health_status=CASE WHEN channel_type='public' THEN health_status ELSE 'healthy' END,
             health_checked_at=CASE WHEN channel_type='public' THEN health_checked_at ELSE NOW() END,
             telegram_access_state=CASE WHEN channel_type='public' THEN telegram_access_state ELSE 'healthy' END,
             reactivated_at=NOW(),
             telegram_access_version=?
         WHERE id=? AND status<>'active' AND is_deleted=FALSE AND telegram_access_version=?`,
        [resumeNewVersion, channelId, fresh.telegram_access_version],
      );
      resumeAffected = update.affectedRows;
      if (resumeAffected > 0) {
        await recordChannelStatusTransitionAudit(conn, {
          channelId,
          telegramChatId: channel.chat_id,
          previousStatus: String(fresh.status),
          newStatus: "active",
          sourceWorker: "admin_channel_actions",
          reasonCode: "admin_manual_resume",
          reasonText: reason || (channel.channel_type === "public" && channel.status === "pending" ? "Public channel approved using existing registration verification" : "Channel resumed by admin after live Telegram verification"),
          evidenceClassification: "manual",
          actorType: "admin",
          actorId: admin?.id || null,
          transitionIntent: "manual",
          verificationVersion: resumeNewVersion,
          recoveryAction: "admin_resume",
          recoveryOutcome: "active",
          notificationGenerated: true,
        });
      }
      await conn.commit();
    } catch (txErr) {
      await conn.rollback().catch(() => undefined);
      throw txErr;
    } finally {
      conn.release();
    }
    if (resumeAffected === 0) return NextResponse.json({ error: "Channel changed during approval; please retry.", code: "CHANNEL_STATUS_CHANGED" }, { status: 409 });
    newValue = { status: "active" };
    if (resumeAffected > 0) {
      const notification = channel.channel_type === "public"
        ? enqueueAssetNotification(pool, { assetType: "channel", assetId: channelId,
            userId: channel.user_id, event: "approved", name: channel.title })
        : notifyChannelApproved(channel.telegram_id, channelId, channel.title);
      await notification.catch((error) => {
        console.error("Channel approval notification failed", {
          channelId,
          error: error instanceof Error ? error.message : "notification_failed",
        });
      });
    }
  } else if (action === "reject") {
    const [update] = await pool.query<ResultSetHeader>(
      "UPDATE channels SET status='rejected',paused_reason='Rejected by admin control center',telegram_access_version=COALESCE(telegram_access_version,0)+1 WHERE id=? AND status<>'rejected'",
      [channelId]
    );
    newValue = { status: "rejected" };
    if (update.affectedRows > 0) {
      await notifyChannelRejected(channel.telegram_id, channelId, channel.title);
    }
  } else if (action === "delete") {
    const [update] = await pool.query<ResultSetHeader>(
      "UPDATE channels SET status='deleted',is_deleted=TRUE,paused_reason=?,telegram_access_version=COALESCE(telegram_access_version,0)+1 WHERE id=? AND is_deleted=FALSE",
      [reason, channelId]
    );
    await clearPrivateTrackingAssignment(channelId, await getChannelPrivacySchema());
    newValue = { status: "deleted", is_deleted: true };
    if (update.affectedRows > 0) {
      await recordChannelStatusTransitionAudit(pool, {
        channelId,
        telegramChatId: channel.chat_id,
        previousStatus: String(channel.status),
        newStatus: "deleted",
        sourceWorker: "admin_channel_actions",
        reasonCode: "admin_manual_delete",
        reasonText: reason || "Deleted by admin control center",
        evidenceClassification: "manual",
        actorType: "admin",
        actorId: admin?.id || null,
        transitionIntent: "manual",
        notificationGenerated: true,
      });
      await notifyChannelRemoved(channel.telegram_id, channelId, channel.title);
    }
  } else if (action === "mark_review" || action === "clear_review") {
    const underReview = action === "mark_review" ? 1 : 0;
    oldValue = { under_review: Boolean(channel.under_review) };
    newValue = { under_review: Boolean(underReview) };
    await pool.query("UPDATE channels SET under_review=? WHERE id=?", [underReview, channelId]);
  } else if (action === "health_check") {
    const health = await verifyTelegramChannelAccess({
      channelId,
      chatId: channel.chat_id,
      username: channel.username,
      source: "admin_manual_check",
      persist: true,
      autoPauseActive: true,
    });
    oldValue = { health_status: "requested" };
    newValue = health;
    result = { success: true, health };
  } else if (action === "view_refresh") {
    result = { success: true, refresh: await refreshChannelViews(channelId) };
    oldValue = { operation: "view_refresh" };
    newValue = result;
  } else if (action === "deletion_readiness") {
    const postId = body.post_id === undefined || body.post_id === null || body.post_id === ""
      ? undefined
      : Number(body.post_id);
    if (postId !== undefined && (!Number.isInteger(postId) || postId <= 0)) {
      return NextResponse.json({ error: "Invalid post" }, { status: 400 });
    }
    result = { success: true, deletion_readiness: await channelDeletionReadiness(channelId, postId) };
    oldValue = { operation: "deletion_readiness", post_id: postId || null };
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
    const [eligibleReinstateRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, chat_id, status, telegram_access_version
       FROM channels
       WHERE user_id=? AND is_deleted=FALSE AND status='paused'
         AND COALESCE(paused_by_actor,'system') NOT IN ('publisher','admin')
         AND admin_paused_at IS NULL AND publisher_paused_at IS NULL
         AND COALESCE(marketplace_admin_status,'approved')='approved'
         AND COALESCE(monetization_paused_reason,'')<>'below_minimum'
         AND COALESCE(below_minimum_review_required,0)=0
         AND COALESCE(subscriber_count,0)>=100
         AND chat_id IS NOT NULL AND TRIM(CAST(chat_id AS CHAR))<>'' AND CAST(chat_id AS CHAR)<>'0'
         AND COALESCE(telegram_access_state,'healthy') NOT IN ('bot_removed','channel_not_found','permission_missing','identity_mismatch')
         AND paused_reason IN (
           'Low Trust Score with Withdrawable Balance Threshold Reached',
           'fraudulent_or_low_quality_traffic'
         )`,
      [channel.user_id]
    );
    const [restoredChannels] = await pool.query<ResultSetHeader>(
      `UPDATE channels
       SET status='active',paused_reason=NULL,under_review=0,publisher_trust_score=60,
           trust_score_frozen_until=DATE_ADD(NOW(),INTERVAL 24 HOUR),reactivated_at=NOW(),
           telegram_access_version=COALESCE(telegram_access_version,0)+1
       WHERE user_id=? AND is_deleted=FALSE AND status='paused'
         AND COALESCE(paused_by_actor,'system') NOT IN ('publisher','admin')
         AND admin_paused_at IS NULL AND publisher_paused_at IS NULL
         AND COALESCE(marketplace_admin_status,'approved')='approved'
         AND COALESCE(monetization_paused_reason,'')<>'below_minimum'
         AND COALESCE(below_minimum_review_required,0)=0
         AND COALESCE(subscriber_count,0)>=100
         AND chat_id IS NOT NULL AND TRIM(CAST(chat_id AS CHAR))<>'' AND CAST(chat_id AS CHAR)<>'0'
         AND COALESCE(telegram_access_state,'healthy') NOT IN ('bot_removed','channel_not_found','permission_missing','identity_mismatch')
         AND paused_reason IN (
           'Low Trust Score with Withdrawable Balance Threshold Reached',
           'fraudulent_or_low_quality_traffic'
         )`,
      [channel.user_id]
    );
    for (const ch of eligibleReinstateRows) {
      await recordChannelStatusTransitionAudit(pool, {
        channelId: Number(ch.id),
        telegramChatId: ch.chat_id,
        previousStatus: String(ch.status),
        newStatus: "active",
        sourceWorker: "admin_channel_actions",
        reasonCode: "admin_manual_reinstate",
        reasonText: reason || "Reinstated by admin control center",
        evidenceClassification: "manual",
        actorType: "admin",
        actorId: admin?.id || null,
        transitionIntent: "manual",
        verificationVersion: Number(ch.telegram_access_version || 0) + 1,
        recoveryAction: "reinstate",
        recoveryOutcome: "active",
      });
    }
    oldValue = { publisher_status: channel.publisher_status, publisher_is_banned: Boolean(channel.publisher_is_banned), channel_status: channel.status };
    newValue = {
      publisher_status: "active",
      publisher_is_banned: false,
      restored_automation_paused_channels: restoredChannels.affectedRows,
      preserved_other_channel_states: true,
      publisher_trust_score: 60,
      trust_enforcement_frozen_hours: 24,
    };
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

  try {
    await audit(admin?.id, channel, action, reason || `admin_${action}`, oldValue, newValue);
  } catch (error) {
    if (action !== "resume" || channel.channel_type !== "private") throw error;
    console.warn("private_channel_admin_audit_failed", {channelId, error: error instanceof Error ? error.name : "unknown"});
    return NextResponse.json({ success: true, post_approval_warning: true });
  }
  return NextResponse.json(result);
}
