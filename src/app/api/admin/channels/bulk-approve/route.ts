import { recordChannelStatusTransitionAudit } from "@/lib/channelStatusAudit";
import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { notifyChannelApproved, notifyChannelRejected } from "@/lib/publisherNotifications";
import { getChannelPrivacySchema } from "@/lib/channelPrivacy";
import { onboardPrivateChannelTracking, privateTrackingFailureMessage } from "@/lib/privateChannelTrackingOnboarding";
import { ChannelVerificationError, verifyAndStoreChannelIdentity } from "@/lib/channelTelegramIdentity";
import { rejectEntityWithPolicy } from "@/lib/moderationRejections";
import { getPublicChannelApprovalEligibility } from "@/lib/publicChannelApproval";
import { enqueueAssetNotification } from "@/lib/platformNotifications";

type PendingChannel = RowDataPacket & {
  id: number;
  user_id: number;
  title: string;
  chat_id: string;
  username: string | null;
  channel_type: "public" | "private";
  telegram_id: string | number | null;
  requires_live_verification?: number | boolean | null;
};

export async function POST(request: Request) {
  const { admin, response } = await requireAdminPermission("operate");
  if (response) return response;

  const body = await request.json().catch(() => ({})) as { channel_ids?: unknown };
  const hasSelection = Object.prototype.hasOwnProperty.call(body, "channel_ids");
  if (hasSelection && !Array.isArray(body.channel_ids)) {
    return NextResponse.json({ error: "channel_ids must be an array" }, { status: 400 });
  }

  const selectedIds = hasSelection
    ? Array.from(new Set((body.channel_ids as unknown[])
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0)))
    : [];
  if (hasSelection && selectedIds.length === 0) {
    return NextResponse.json({ error: "Select at least one pending channel" }, { status: 400 });
  }
  if (selectedIds.length > 500) {
    return NextResponse.json({ error: "Select no more than 500 channels at once" }, { status: 400 });
  }

  const params: number[] = [];
  let selectionClause = "";
  if (hasSelection) {
    selectionClause = ` AND ch.id IN (${selectedIds.map(() => "?").join(",")})`;
    params.push(...selectedIds);
  }
  const [channels] = await pool.query<PendingChannel[]>(
    `SELECT ch.id,ch.user_id,ch.title,ch.chat_id,ch.username,ch.channel_type,u.telegram_id,
            1 AS requires_live_verification
     FROM channels ch JOIN users u ON u.id=ch.user_id
     LEFT JOIN channel_telegram_identities ti ON ti.channel_id=ch.id
     WHERE ch.status='pending' AND ch.is_deleted=FALSE${selectionClause}
     ORDER BY ch.id`,
    params
  );

  let approved = 0;
  const notificationFailures: number[] = [];
  const trackingOnboardingFailures: Array<{ channel_id: number; reason: string }> = [];
  const identityVerificationFailures: Array<{ channel_id: number; reason: string }> = [];
  const approvalFailures: Array<{ channel_id: number; reason: string }> = [];
  const rejected: Array<{ channel_id: number; rule: number; reason: string }> = [];
  const missingPermission: Array<{ channel_id: number; rule: number; reason: string }> = [];
  const deferred: Array<{ channel_id: number; reason: string; retry_at: string | null }> = [];
  const unresolved: Array<{ channel_id: number; reason: string }> = [];
  let sharedCooldownUntil = 0;
  const privacySchema = await getChannelPrivacySchema();
  for (const channel of channels) {
    try {
      let confirmedPrivateTracking: number | null = null;
      if (channel.channel_type === "public") {
        const eligibility = await getPublicChannelApprovalEligibility(channel.id);
        if (!eligibility.eligible) {
          unresolved.push({ channel_id: channel.id, reason: eligibility.reason });
          continue;
        }
      }
      if (channel.channel_type !== "public") {
        if (channel.channel_type === "private") {
          const tracking = await onboardPrivateChannelTracking({
            channelId: channel.id,
            chatId: channel.chat_id,
            channelType: "private",
            schema: privacySchema,
          });
          if (tracking.status !== "active") {
            if (tracking.status === "pending_manual" && /rate.limit|flood/i.test(tracking.reason)) {
              deferred.push({ channel_id: channel.id, reason: privateTrackingFailureMessage(tracking.reason), retry_at: tracking.retryAfterSeconds ? new Date(Date.now() + tracking.retryAfterSeconds * 1000).toISOString() : null });
              continue;
            }
            const fix = privateTrackingFailureMessage(tracking.status === "pending_manual" ? tracking.reason : "tracking_not_active");
            await pool.query("UPDATE channels SET failure_reason=?,suggested_fix=? WHERE id=? AND status='pending'",
              [tracking.status === "pending_manual" ? tracking.reason : "private_tracking_unverified", fix, channel.id]);
            trackingOnboardingFailures.push({ channel_id: channel.id, reason: fix });
            continue;
          }
          confirmedPrivateTracking = tracking.tracking_account;
        }
      }

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [lockedRows] = await conn.query<RowDataPacket[]>(
          `SELECT c.id, c.status, c.is_deleted, c.under_review, c.marketplace_admin_status,
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
          [channel.id],
        );
        const locked = lockedRows[0];
        if (!locked || locked.status !== "pending" || Boolean(locked.is_deleted)) {
          await conn.rollback();
          continue;
        }
        if (channel.channel_type === "private" && (locked.channel_type !== "private" || String(locked.chat_id) !== String(channel.chat_id)
          || Number(locked.tracking_account) !== confirmedPrivateTracking || locked.tracking_account_status !== "active"
          || !["member", "already_member"].includes(String(locked.tracking_account_member_status)))) {
          await conn.rollback();
          unresolved.push({ channel_id: channel.id, reason: "Private channel membership changed during approval; retry manually." });
          continue;
        }
        if (locked.marketplace_admin_status === "rejected") {
          await conn.rollback();
          unresolved.push({ channel_id: channel.id, reason: "Channel was rejected during approval" });
          continue;
        }
        if (locked.automation_suspended_until && new Date(String(locked.automation_suspended_until)) > new Date()) {
          await conn.rollback();
          unresolved.push({ channel_id: channel.id, reason: "Channel is suspended by automation controls" });
          continue;
        }
        if (channel.channel_type === "public") {
          const lockedEligibility = await getPublicChannelApprovalEligibility(channel.id, conn);
          if (!lockedEligibility.eligible) {
            await conn.rollback();
            unresolved.push({ channel_id: channel.id, reason: lockedEligibility.reason });
            continue;
          }
        }
        if (Boolean(locked.publisher_is_banned) || locked.publisher_status !== "active") {
          await conn.rollback();
          unresolved.push({ channel_id: channel.id, reason: "Publisher account is not active" });
          continue;
        }
        if (locked.subscriber_count === null || locked.subscriber_count === undefined || Number(locked.subscriber_count) < 100) {
          await conn.rollback();
          unresolved.push({ channel_id: channel.id, reason: "Subscriber count below minimum (100) or unknown" });
          continue;
        }
        if (Boolean(locked.under_review)) {
          await conn.rollback();
          unresolved.push({ channel_id: channel.id, reason: "Channel is under manual review" });
          continue;
        }
        if (locked.paused_by_actor === "admin" || Boolean(locked.admin_paused_at)) {
          await conn.rollback();
          unresolved.push({ channel_id: channel.id, reason: "Channel was paused by administrator" });
          continue;
        }
        if (locked.paused_by_actor === "publisher" || Boolean(locked.publisher_paused_at)) {
          await conn.rollback();
          unresolved.push({ channel_id: channel.id, reason: "Channel was paused by publisher" });
          continue;
        }
        if (locked.settlement_excluded_until && new Date(String(locked.settlement_excluded_until)) > new Date()) {
          await conn.rollback();
          unresolved.push({ channel_id: channel.id, reason: "Channel has active settlement hold" });
          continue;
        }
        if (locked.automation_suspension_status && locked.automation_suspension_status !== "active") {
          await conn.rollback();
          unresolved.push({ channel_id: channel.id, reason: "Channel is suspended by automation controls" });
          continue;
        }
        if (locked.revenue_protection_status && locked.revenue_protection_status !== "normal") {
          await conn.rollback();
          unresolved.push({ channel_id: channel.id, reason: "Channel is restricted by revenue protection" });
          continue;
        }
        if (locked.monetization_paused_reason === "below_minimum" || Boolean(locked.below_minimum_review_required)) {
          await conn.rollback();
          unresolved.push({ channel_id: channel.id, reason: "Channel is marked below minimum subscribers" });
          continue;
        }

        const newVersion = Number(locked.telegram_access_version || 0) + 1;
        const [update] = await conn.query<ResultSetHeader>(
          `UPDATE channels
           SET status='active',
               is_deleted=FALSE,
               paused_reason=NULL,
               failure_reason=NULL,
               suggested_fix=NULL,
               health_status=CASE WHEN channel_type='private' THEN 'healthy' ELSE 'warning' END,
               health_checked_at=CASE WHEN channel_type='private' THEN NOW() ELSE NULL END,
               reactivated_at=NOW(),
               telegram_access_version=?
           WHERE id=? AND status='pending' AND is_deleted=FALSE AND telegram_access_version=?`,
          [newVersion, channel.id, locked.telegram_access_version],
        );

        if (update.affectedRows === 0) {
          await conn.rollback();
          continue;
        }

        await recordChannelStatusTransitionAudit(conn, {
          channelId: Number(channel.id),
          telegramChatId: channel.chat_id,
          previousStatus: "pending",
          newStatus: "active",
          sourceWorker: "admin_bulk_approve",
          reasonCode: "admin_bulk_approve_verified",
          reasonText: channel.channel_type === "public" ? "Public channel approved using existing registration verification" : "Bulk-approved private channel after membership confirmation",
          evidenceClassification: "manual",
          actorType: "admin",
          actorId: admin?.id || null,
          transitionIntent: "manual",
          verificationVersion: newVersion,
          notificationGenerated: true,
          requireTable: true,
        });

        await conn.query(
          `INSERT INTO channel_admin_action_audits(admin_id,action,channel_id,publisher_id,old_value,new_value,reason)
           VALUES(?,?,?,?,?,?,?)`,
          [admin?.id || null, "bulk_approve", channel.id, channel.user_id,
            JSON.stringify({ status: "pending" }), JSON.stringify({ status: "active" }),
            hasSelection ? "admin_bulk_approve_selected" : "admin_bulk_approve_all_pending"]
        );

        await conn.commit();
        approved += 1;
        try {
          await recordAdminActionAudit({
            adminId: admin?.id,
            action: "channel_bulk_approve",
            entityType: "channel",
            entityId: channel.id,
            reason: hasSelection ? "admin_bulk_approve_selected" : "admin_bulk_approve_all_pending",
            metadata: { publisher_id: channel.user_id },
          });
        } catch (auditError) {
          console.error("Bulk channel approval post-commit audit failed", {
            channelId: channel.id,
            error: auditError instanceof Error ? auditError.message : "audit_failed",
          });
        }
      } catch (txErr) {
        await conn.rollback().catch(() => undefined);
        throw txErr;
      } finally {
        conn.release();
      }

      const notification = channel.channel_type === "public"
        ? enqueueAssetNotification(pool, { assetType: "channel", assetId: channel.id,
            userId: channel.user_id, event: "approved", name: channel.title })
        : notifyChannelApproved(channel.telegram_id, channel.id, channel.title);
      await notification.catch(() => { notificationFailures.push(channel.id); });
    } catch (error) {
      approvalFailures.push({
        channel_id: channel.id,
        reason: "Channel approval encountered an unexpected error and was skipped.",
      });
      console.error("Bulk channel approval failed", {
        channelId: channel.id,
        error: error instanceof Error ? error.message : "approval_failed",
      });
    }
  }

  return NextResponse.json({
    success: true,
    requested: hasSelection ? selectedIds.length : channels.length,
    approved,
    skipped: (hasSelection ? selectedIds.length : channels.length) - approved,
    notification_failures: notificationFailures,
    tracking_onboarding_failures: trackingOnboardingFailures,
    identity_verification_failures: identityVerificationFailures,
    approval_failures: approvalFailures,
    rejected,
    missing_permission: missingPermission,
    deferred,
    unresolved,
  });
}
