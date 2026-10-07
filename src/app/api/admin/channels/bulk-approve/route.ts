import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { notifyChannelApproved, notifyChannelRejected } from "@/lib/publisherNotifications";
import { getChannelPrivacySchema } from "@/lib/channelPrivacy";
import { onboardPrivateChannelTracking } from "@/lib/privateChannelTrackingOnboarding";
import { ChannelVerificationError, verifyAndStoreChannelIdentity } from "@/lib/channelTelegramIdentity";
import { rejectEntityWithPolicy } from "@/lib/moderationRejections";

type PendingChannel = RowDataPacket & {
  id: number;
  user_id: number;
  title: string;
  chat_id: string;
  username: string | null;
  channel_type: "public" | "private";
  telegram_id: string | number | null;
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
    `SELECT ch.id,ch.user_id,ch.title,ch.chat_id,ch.username,ch.channel_type,u.telegram_id
     FROM channels ch JOIN users u ON u.id=ch.user_id
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
    if (sharedCooldownUntil > Date.now()) {
      deferred.push({ channel_id: channel.id, reason: "Telegram verification deferred because the shared Bot API caller is cooling down.", retry_at: new Date(sharedCooldownUntil).toISOString() });
      continue;
    }
    try {
      let identity;
      try {
        identity = await verifyAndStoreChannelIdentity({
          channelId: channel.id,
          chatId: channel.chat_id,
          username: channel.username,
          source: "bulk_approve",
        });
      } catch (error) {
        if (error instanceof ChannelVerificationError) {
          if (error.code === "temporarily_rate_limited") {
            sharedCooldownUntil = Date.now() + Math.max(1, Number(error.retryAfterSeconds || 60)) * 1000;
            deferred.push({ channel_id: channel.id, reason: error.message, retry_at: new Date(sharedCooldownUntil).toISOString() });
            continue;
          }
          if (error.code === "temporary_telegram_error") {
            deferred.push({ channel_id: channel.id, reason: error.message, retry_at: null });
            continue;
          }
          if (error.code === "inaccessible_channel") {
            await rejectEntityWithPolicy({ entityType: "channel", entityId: channel.id,
              ruleKey: "publisher.channel.inaccessible-channel", publicRuleNumber: 4,
              internalNote: error.message, adminId: Number(admin?.id || 0) });
            rejected.push({ channel_id: channel.id, rule: 4, reason: error.message });
            await notifyChannelRejected(channel.telegram_id, channel.id, channel.title).catch(() => notificationFailures.push(channel.id));
            continue;
          }
          if (error.code === "missing_permission") {
            await rejectEntityWithPolicy({ entityType: "channel", entityId: channel.id,
              ruleKey: "publisher.channel.missing-permissions", publicRuleNumber: 5,
              internalNote: error.message, adminId: Number(admin?.id || 0) });
            missingPermission.push({ channel_id: channel.id, rule: 5, reason: error.message });
            await notifyChannelRejected(channel.telegram_id, channel.id, channel.title).catch(() => notificationFailures.push(channel.id));
            continue;
          }
          unresolved.push({ channel_id: channel.id, reason: error.message });
          continue;
        }
        identityVerificationFailures.push({
          channel_id: channel.id,
          reason: error instanceof Error ? error.message : "Telegram channel verification failed.",
        });
        continue;
      }

      channel.chat_id = identity.chatId;
      channel.username = identity.username;

      const tracking = await onboardPrivateChannelTracking({
        channelId: channel.id,
        chatId: channel.chat_id,
        channelType: channel.channel_type === "private" ? "private" : "public",
        schema: privacySchema,
      });

      if (channel.channel_type === "private" && tracking.status !== "active") {
        if (tracking.status === "pending_manual" && tracking.reason === "bot_invite_permission_missing") {
          await rejectEntityWithPolicy({ entityType: "channel", entityId: channel.id,
            ruleKey: "publisher.channel.missing-permissions", publicRuleNumber: 5,
            internalNote: "Ads Galaxy bot needs invite/add-member permission for private tracking onboarding.",
            adminId: Number(admin?.id || 0) });
          missingPermission.push({ channel_id: channel.id, rule: 5, reason: "Invite/add-member permission is missing." });
          await notifyChannelRejected(channel.telegram_id, channel.id, channel.title).catch(() => notificationFailures.push(channel.id));
          continue;
        }
        trackingOnboardingFailures.push({
          channel_id: channel.id,
          reason: tracking.status === "pending_manual"
            ? tracking.reason
            : "Private-channel tracking membership could not be verified.",
        });
        continue;
      }

      const [update] = await pool.query<ResultSetHeader>(
        `UPDATE channels SET status='active',is_deleted=FALSE,paused_reason=NULL,
           failure_reason=NULL,health_status='healthy',health_checked_at=NOW(),reactivated_at=NOW()
         WHERE id=? AND status='pending' AND is_deleted=FALSE`,
        [channel.id]
      );

      if (update.affectedRows === 0) continue;
      approved += 1;

      try {
        await pool.query(
          `INSERT INTO channel_admin_action_audits(admin_id,action,channel_id,publisher_id,old_value,new_value,reason)
           VALUES(?,?,?,?,?,?,?)`,
          [admin?.id || null, "bulk_approve", channel.id, channel.user_id,
            JSON.stringify({ status: "pending" }), JSON.stringify({ status: "active" }),
            hasSelection ? "admin_bulk_approve_selected" : "admin_bulk_approve_all_pending"]
        );

        await recordAdminActionAudit({
          adminId: admin?.id,
          action: "channel_bulk_approve",
          entityType: "channel",
          entityId: channel.id,
          reason: hasSelection ? "admin_bulk_approve_selected" : "admin_bulk_approve_all_pending",
          metadata: { publisher_id: channel.user_id },
        });
      } catch (error) {
        console.error("Bulk channel approval audit failed", {
          channelId: channel.id,
          error: error instanceof Error ? error.message : "audit_failed",
        });
      }

      await notifyChannelApproved(channel.telegram_id, channel.id, channel.title).catch(() => {
        notificationFailures.push(channel.id);
      });
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
