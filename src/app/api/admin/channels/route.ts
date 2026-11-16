import { recordChannelStatusTransitionAudit } from "@/lib/channelStatusAudit";
import { NextResponse } from "next/server";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- legacy admin channel payloads are not schema-generated */
import pool from "@/lib/db";
import { checkAdminAuth, requireAdminPermission } from "@/lib/adminAuth";
import { escapeTelegramHtml, sendTelegramMessage } from "@/lib/telegram";
import { ensureDefaultChannelDistribution } from "@/lib/channelLifecycle";
import { getChannelPrivacySchema } from "@/lib/channelPrivacy";
import {
  clearPrivateTrackingAssignment,
  onboardPrivateChannelTracking,
  privateTrackingFailureMessage,
} from "@/lib/privateChannelTrackingOnboarding";
import { decryptPrivateInviteLink } from "@/lib/privateInviteLinkVault";
import { classifyChannelGeoConfidence } from "@/lib/channelGeoQuality";
import { parseAdminPagination } from "@/lib/adminPagination";
import { ChannelVerificationError, verifyAndStoreChannelIdentity } from "@/lib/channelTelegramIdentity";
import { getPublicChannelApprovalEligibility } from "@/lib/publicChannelApproval";
import { evaluateUnifiedChannelEligibility } from "@/lib/channelEligibility";
import { enqueueAssetNotification } from "@/lib/platformNotifications";
import { rejectEntityWithPolicy } from "@/lib/moderationRejections";
import { notifyChannelRejected } from "@/lib/publisherNotifications";

async function tableExists(table: string) {
  const [rows]: any = await pool.query("SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? LIMIT 1", [table]);
  return rows.length > 0;
}

function withPrivateModerationLinks(rows: any[]) {
  return rows.map((row) => {
    const privateUrl = row.channel_type === "private"
      ? decryptPrivateInviteLink(row.private_invite_link_encrypted)
      : null;
    const { private_invite_link_encrypted, ...safeRow } = row;
    return {
      ...safeRow,
      private_invite_link_url: privateUrl,
    };
  });
}

export async function GET(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const { page, limit, offset } = parseAdminPagination(searchParams, { defaultLimit: 10 });
  const statusFilter = searchParams.get("status") || "all";
  const qualityFilter = searchParams.get("quality") || "all";
  const riskFilter = searchParams.get("risk") || "all";
  const search = searchParams.get("search") || "";

  try {
    const hasGeoClassifications = await tableExists("channel_geo_classifications");
    const geoFields = hasGeoClassifications
      ? ", geo.selected_region AS geo_selected_region,geo.authoritative_region AS geo_authoritative_region,geo.confidence AS geo_confidence,geo.reason AS geo_reason,geo.conflict_detected AS geo_conflict_detected,geo.status AS geo_status"
      : ", NULL AS geo_selected_region,NULL AS geo_authoritative_region,'unknown' AS geo_confidence,'not_classified' AS geo_reason,0 AS geo_conflict_detected,'stale' AS geo_status";
    const geoJoin = hasGeoClassifications ? " LEFT JOIN channel_geo_classifications geo ON geo.channel_id=c.id" : "";
    const hasTelegramIdentities = await tableExists("channel_telegram_identities");
    const identityFields = hasTelegramIdentities
      ? `, ti.telegram_chat_id AS telegram_identity_chat_id,ti.current_username AS telegram_current_username,
          ti.previous_username AS telegram_previous_username,ti.bot_member_status,ti.bot_can_post,
          ti.verification_state AS telegram_verification_state,ti.last_checked_at AS telegram_access_checked_at,
          ti.last_verified_at AS telegram_last_verified_at,ti.last_username_changed_at,
          ti.last_failure_code AS telegram_failure_code,ti.last_failure_reason AS telegram_failure_reason`
      : `, NULL AS telegram_identity_chat_id,NULL AS telegram_current_username,NULL AS telegram_previous_username,
          NULL AS bot_member_status,NULL AS bot_can_post,NULL AS telegram_verification_state,
          NULL AS telegram_access_checked_at,NULL AS telegram_last_verified_at,
          NULL AS last_username_changed_at,NULL AS telegram_failure_code,NULL AS telegram_failure_reason`;
    const identityJoin = hasTelegramIdentities ? " LEFT JOIN channel_telegram_identities ti ON ti.channel_id=c.id" : "";
    const recoveryFields = `,
      (SELECT a.reason FROM channel_admin_action_audits a
       WHERE a.channel_id=c.id AND a.action IN ('telegram_recovery_audit','telegram_identity_sync')
       ORDER BY a.created_at DESC,a.id DESC LIMIT 1) AS telegram_recovery_reason,
      (SELECT a.created_at FROM channel_admin_action_audits a
       WHERE a.channel_id=c.id AND a.action IN ('telegram_recovery_audit','telegram_identity_sync')
       ORDER BY a.created_at DESC,a.id DESC LIMIT 1) AS telegram_recovery_checked_at`;
    let query = `
      SELECT c.*, u.first_name, u.last_name, u.username AS owner_username, u.telegram_id as owner_telegram_id
        ${geoFields} ${identityFields} ${recoveryFields}
      FROM channels c
      LEFT JOIN users u ON c.user_id = u.id
      ${geoJoin}
      ${identityJoin}
    `;
    let countQuery = "SELECT COUNT(*) as total FROM channels c LEFT JOIN users u ON c.user_id = u.id";
    const queryParams: any[] = [];

    let whereClause = " WHERE c.is_deleted = FALSE";

    if (statusFilter !== "all") {
      whereClause += " AND c.status = ?";
      queryParams.push(statusFilter);
    }

    if (qualityFilter !== "all") {
      whereClause += " AND COALESCE(c.traffic_quality_tier, 'good') = ?";
      queryParams.push(qualityFilter);
    }

    if (riskFilter !== "all") {
      whereClause += " AND COALESCE(c.traffic_risk_level, 'low') = ?";
      queryParams.push(riskFilter);
    }

    if (search) {
      whereClause += ` AND (
        c.title LIKE ? OR 
        c.username LIKE ? OR 
        c.chat_id LIKE ? OR 
        c.user_id LIKE ? OR
        u.first_name LIKE ? OR 
        u.last_name LIKE ? OR 
        u.username LIKE ? OR 
        u.telegram_id LIKE ?
      )`;
      const searchVal = `%${search}%`;
      queryParams.push(searchVal, searchVal, searchVal, searchVal, searchVal, searchVal, searchVal, searchVal);
    }

    query += whereClause + " ORDER BY c.id DESC LIMIT ? OFFSET ?";
    countQuery += whereClause;

    const [rows]: any = await pool.query(query, [...queryParams, limit, offset]);
    const [[countRow]]: any = await pool.query(countQuery, queryParams);
    const [[summary]]: any = await pool.query(`
      SELECT
        SUM(CASE WHEN status = 'pending' AND is_deleted = FALSE THEN 1 ELSE 0 END) as pending_channels,
        SUM(CASE WHEN status = 'active' AND is_deleted = FALSE THEN 1 ELSE 0 END) as active_channels,
        SUM(CASE WHEN status = 'active' AND is_deleted = FALSE THEN 1 ELSE 0 END) as delivery_eligible_channels,
        SUM(CASE WHEN status IN ('paused', 'bot_removed', 'channel_not_found', 'permission_missing') AND is_deleted = FALSE THEN 1 ELSE 0 END) as paused_channels,
        SUM(CASE WHEN status IN ('bot_removed', 'channel_not_found', 'permission_missing') AND is_deleted = FALSE THEN 1 ELSE 0 END) as failed_channels,
        SUM(CASE WHEN under_review=TRUE AND is_deleted=FALSE THEN 1 ELSE 0 END) as manual_review_channels,
        SUM(CASE WHEN status = 'deleted' OR is_deleted = TRUE THEN 1 ELSE 0 END) as deleted_channels,
        SUM(CASE WHEN status = 'active' AND is_deleted = FALSE THEN subscriber_count ELSE 0 END) as active_subscribers,
        SUM(CASE WHEN status = 'active' AND is_deleted = FALSE THEN subscriber_count ELSE 0 END) as delivery_eligible_subscribers
      FROM channels
    `);

    return NextResponse.json({
      channels: withPrivateModerationLinks(rows),
      total: countRow.total,
      page,
      totalPages: Math.ceil(countRow.total / limit),
      summary,
    });
  } catch (error: any) {
    console.error("Admin Channels API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { admin, response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const { id, action } = await request.json();
    const normalizedAction = action === "deny" ? "reject" : action === "approve" ? "activate" : action;
    if (normalizedAction === "reject") return NextResponse.json({ error: "MODERATION_REASON_REQUIRED", code: "MODERATION_REASON_REQUIRED" }, { status: 400 });

    // Fetch channel and owner details
    const [rows]: any = await pool.query(
      `SELECT c.id, c.user_id, c.status, c.is_deleted, c.title, c.username, c.chat_id, c.channel_type,
              c.audience_continents, c.under_review, c.marketplace_admin_status,
              c.monetization_paused_reason, c.below_minimum_review_required,
              c.settlement_excluded_until, c.automation_suspension_status,
              c.automation_suspended_until, c.revenue_protection_status,
              u.telegram_id, u.status AS publisher_status, COALESCE(u.is_banned, 0) AS publisher_is_banned
       FROM channels c 
       JOIN users u ON c.user_id = u.id 
       WHERE c.id = ?`,
      [id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const channel = rows[0];
    const statusMap: Record<string, string> = {
      activate: "active",
      pause: "paused",
      reject: "rejected",
      delete: "deleted",
    };

    if (!statusMap[normalizedAction]) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const status = statusMap[normalizedAction];
    let postApprovalWarning = false;

    if (normalizedAction === "activate") {
      if (channel.channel_type === "public" && channel.status === "active" && !Boolean(channel.is_deleted) && channel.marketplace_admin_status !== "rejected") {
        return NextResponse.json({ success: true, already_approved: true });
      }
      if (Boolean(channel.is_deleted) || channel.status === "deleted") {
        return NextResponse.json({ error: "Deleted channels cannot be activated.", code: "CHANNEL_DELETED" }, { status: 409 });
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
        const eligibility = await getPublicChannelApprovalEligibility(Number(id));
        if (!eligibility.eligible) return NextResponse.json({ error: eligibility.reason }, { status: 409 });
      }
      if (channel.channel_type === "public" && channel.status !== "pending") {
      let identity;
      try {
        identity = await verifyAndStoreChannelIdentity({
          channelId: id,
          chatId: channel.chat_id,
          username: channel.username,
          source: "admin_activate",
        });
      } catch (error) {
        if (!(error instanceof ChannelVerificationError)) throw error;
        if (["temporarily_rate_limited", "temporary_telegram_error"].includes(error.code)) {
          const retryAt = error.retryAfterSeconds
            ? new Date(Date.now() + error.retryAfterSeconds * 1000).toISOString()
            : null;
          return NextResponse.json({ error: error.message, code: "TEMPORARILY_UNVERIFIED", classification: error.code, retry_at: retryAt }, { status: 409 });
        }
        if (error.code === "inaccessible_channel" || error.code === "missing_permission") {
          const fix = error.code === "missing_permission"
            ? "Add the AdsGalaxy bot as channel administrator with posting and invite permissions."
            : channel.channel_type === "private"
              ? "Add the designated AdsGalaxy bot and tracking account to this private channel."
              : "Add the AdsGalaxy bot as channel administrator with posting permissions.";
          await pool.query("UPDATE channels SET failure_reason=?,suggested_fix=? WHERE id=? AND status='pending'",
            [error.message, fix, id]);
          return NextResponse.json({ error: fix, classification: error.code }, { status: 409 });
        }
        return NextResponse.json({ error: error.message, code: error.code === "identity_conflict" ? "IDENTITY_CONFLICT" : "IDENTITY_UNRESOLVED", classification: error.code }, { status: 409 });
      }
      channel.chat_id = identity.chatId;
      channel.username = identity.username;
      }
      let confirmedPrivateTracking: number | null = null;
      if (channel.channel_type === "private") {
        const privacySchema = await getChannelPrivacySchema();
        const tracking = await onboardPrivateChannelTracking({
          channelId: id,
          chatId: channel.chat_id,
          channelType: "private",
          schema: privacySchema,
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
      let activatedAffected = 0;
      let activatedNewVersion = 1;
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
          [id],
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
          const lockedEligibility = await getPublicChannelApprovalEligibility(Number(id), conn);
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

        activatedNewVersion = Number(fresh.telegram_access_version || 0) + 1;
        const [update] = await conn.query<ResultSetHeader>(
          `UPDATE channels
           SET status = ?,
               is_deleted = FALSE,
               paused_reason = NULL,
               paused_by_actor = NULL,
               admin_paused_at = NULL,
               publisher_paused_at = NULL,
               suggested_fix = NULL,
               failure_reason = NULL,
               health_status = CASE WHEN channel_type='public' THEN health_status ELSE 'healthy' END,
               health_checked_at = CASE WHEN channel_type='public' THEN health_checked_at ELSE NOW() END,
               telegram_access_state = CASE WHEN channel_type='public' THEN telegram_access_state ELSE 'healthy' END,
               telegram_access_version = ?,
               reactivated_at = NOW()
           WHERE id = ? AND is_deleted = FALSE AND telegram_access_version = ?`,
          [status, activatedNewVersion, id, fresh.telegram_access_version]
        );
        activatedAffected = update.affectedRows;
        if (activatedAffected > 0 && String(fresh.status) !== "active") {
          await recordChannelStatusTransitionAudit(conn, {
            channelId: Number(id),
            telegramChatId: channel.chat_id,
            previousStatus: String(fresh.status),
            newStatus: "active",
            sourceWorker: "admin_channels_patch",
            reasonCode: "admin_channel_approved_or_activated",
            reasonText: channel.channel_type === "public" && channel.status === "pending" ? "Public channel approved using existing registration verification" : "Channel activated by admin after live Telegram verification",
            evidenceClassification: "manual",
            actorType: "admin",
            actorId: admin?.id || null,
            transitionIntent: "manual",
            verificationVersion: activatedNewVersion,
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
      if (activatedAffected === 0) return NextResponse.json({ error: "Channel changed during approval; please retry.", code: "CHANNEL_STATUS_CHANGED" }, { status: 409 });
      try {
      await ensureDefaultChannelDistribution();
      if (await tableExists("channel_geo_classifications")) {
        const geo = classifyChannelGeoConfidence({ publisherSelected: channel.audience_continents });
        await pool.query(`INSERT INTO channel_geo_classifications
          (channel_id,selected_region,authoritative_region,confidence,source,reason,evidence,conflict_detected,status,classified_at)
          VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())
          ON DUPLICATE KEY UPDATE selected_region=VALUES(selected_region),authoritative_region=VALUES(authoritative_region),
            confidence=VALUES(confidence),source=VALUES(source),reason=VALUES(reason),evidence=VALUES(evidence),
            conflict_detected=VALUES(conflict_detected),status=VALUES(status),classified_at=VALUES(classified_at)`,
          [id, geo.selected_region, geo.authoritative_region, geo.confidence, "admin_channel_activation", geo.reason,
            JSON.stringify({ publisher_selected: channel.audience_continents, language_hint: geo.language_hint }), geo.conflict_detected ? 1 : 0,
            geo.conflict_detected ? "review_required" : "current"]);
      }
      } catch (error) {
        if (channel.channel_type !== "private") throw error;
        postApprovalWarning = true;
        console.warn("private_channel_post_approval_followup_failed", {channelId: Number(id), error: error instanceof Error ? error.name : "unknown"});
      }
    } else if (normalizedAction === "delete") {
      await pool.query("UPDATE channels SET status = ?, is_deleted = TRUE, paused_reason = 'Deleted by admin.', suggested_fix = NULL, telegram_access_version = COALESCE(telegram_access_version, 0) + 1 WHERE id = ?", [status, id]);
      await clearPrivateTrackingAssignment(id, await getChannelPrivacySchema());
      if (String(channel.status) !== "deleted") {
        await recordChannelStatusTransitionAudit(pool, {
          channelId: Number(id),
          telegramChatId: channel.chat_id,
          previousStatus: String(channel.status),
          newStatus: "deleted",
          sourceWorker: "admin_channels_patch",
          reasonCode: "admin_channel_deleted",
          reasonText: "Deleted by admin.",
          evidenceClassification: "manual",
          actorType: "admin",
          actorId: admin?.id || null,
          transitionIntent: "manual",
        });
      }
    } else {
      await pool.query(
        `UPDATE channels
         SET status = ?,
             paused_reason = ?,
             suggested_fix = ?,
             paused_by_actor = CASE WHEN ? = 'paused' THEN 'admin' ELSE paused_by_actor END,
             admin_paused_at = CASE WHEN ? = 'paused' THEN UTC_TIMESTAMP(6) ELSE admin_paused_at END,
             telegram_access_version = COALESCE(telegram_access_version, 0) + 1
         WHERE id = ?`,
        [
          status,
          status === "paused" ? "Paused by admin." : null,
          status === "paused" ? "Contact support or reactivate after fixing channel access." : null,
          status,
          status,
          id,
        ]
      );
      if (String(channel.status) !== String(status)) {
        await recordChannelStatusTransitionAudit(pool, {
          channelId: Number(id),
          telegramChatId: channel.chat_id,
          previousStatus: String(channel.status),
          newStatus: String(status),
          sourceWorker: "admin_channels_patch",
          reasonCode: status === "paused" ? "admin_channel_paused" : `admin_status_${status}`,
          reasonText: status === "paused" ? "Paused by admin." : `Status set to ${status} by admin.`,
          evidenceClassification: "manual",
          actorType: "admin",
          actorId: admin?.id || null,
          transitionIntent: "manual",
        });
      }
    }

    // Send Telegram Notification
    const channelLabel = channel.username ? `@${escapeTelegramHtml(channel.username)}` : "your private channel";
    const message = normalizedAction === "activate"
      ? `✅ <b>Channel Approved!</b>\n\nYour channel <b>${escapeTelegramHtml(channel.title)}</b> (${channelLabel}) has been approved and is now active in the advertisements network.`
      : `❌ <b>Channel Rejected</b>\n\nUnfortunately, your channel <b>${escapeTelegramHtml(channel.title)}</b> (${channelLabel}) was not approved for monetization at this time.`;

    if (normalizedAction === "activate" && channel.channel_type === "public") {
      await enqueueAssetNotification(pool, { assetType: "channel", assetId: Number(id),
        userId: Number(channel.user_id), event: "approved", name: channel.title });
    } else if (normalizedAction === "activate" || normalizedAction === "reject") {
      try {
        const sent = await sendTelegramMessage(channel.telegram_id, message, { parse_mode: "HTML" });
        if (normalizedAction === "activate" && channel.channel_type === "private" && !sent?.ok) postApprovalWarning = true;
      } catch (error) {
        if (normalizedAction !== "activate" || channel.channel_type !== "private") throw error;
        postApprovalWarning = true;
        console.warn("private_channel_approval_notification_failed", {channelId: Number(id), error: error instanceof Error ? error.name : "unknown"});
      }
    }

    return NextResponse.json(postApprovalWarning ? { success: true, post_approval_warning: true } : { success: true });
  } catch (error: any) {
    console.error("Admin Channels Update Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
