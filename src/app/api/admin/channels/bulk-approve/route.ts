import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { requireAdminPermission } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { notifyChannelApproved } from "@/lib/publisherNotifications";
import { getChannelPrivacySchema } from "@/lib/channelPrivacy";
import { onboardPrivateChannelTracking } from "@/lib/privateChannelTrackingOnboarding";

type PendingChannel = RowDataPacket & {
  id: number;
  user_id: number;
  title: string;
  chat_id: string;
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
    `SELECT ch.id,ch.user_id,ch.title,ch.chat_id,ch.channel_type,u.telegram_id
     FROM channels ch JOIN users u ON u.id=ch.user_id
     WHERE ch.status='pending' AND ch.is_deleted=FALSE${selectionClause}
     ORDER BY ch.id`,
    params
  );

  let approved = 0;
  const notificationFailures: number[] = [];
  const trackingOnboardingFailures: Array<{ channel_id: number; reason: string }> = [];
  const privacySchema = await getChannelPrivacySchema();
  for (const channel of channels) {
    const tracking = await onboardPrivateChannelTracking({
      channelId: channel.id,
      chatId: channel.chat_id,
      channelType: channel.channel_type === "private" ? "private" : "public",
      schema: privacySchema,
    });
    if (channel.channel_type === "private" && tracking.status !== "active") {
      trackingOnboardingFailures.push({
        channel_id: channel.id,
        reason: tracking.status === "pending_manual" ? tracking.reason : "tracking_membership_not_verified",
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
    await notifyChannelApproved(channel.telegram_id, channel.id, channel.title).catch(() => {
      notificationFailures.push(channel.id);
    });
  }

  return NextResponse.json({
    success: true,
    requested: hasSelection ? selectedIds.length : channels.length,
    approved,
    skipped: (hasSelection ? selectedIds.length : channels.length) - approved,
    notification_failures: notificationFailures,
    tracking_onboarding_failures: trackingOnboardingFailures,
  });
}
