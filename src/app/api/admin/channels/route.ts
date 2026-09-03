import { NextResponse } from "next/server";
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- legacy admin channel payloads are not schema-generated */
import pool from "@/lib/db";
import { checkAdminAuth, requireAdminPermission } from "@/lib/adminAuth";
import { escapeTelegramHtml, sendTelegramMessage } from "@/lib/telegram";
import { ensureDefaultChannelDistribution } from "@/lib/channelLifecycle";
import { getChannelPrivacySchema } from "@/lib/channelPrivacy";
import {
  clearPrivateTrackingAssignment,
  onboardPrivateChannelTracking,
} from "@/lib/privateChannelTrackingOnboarding";
import { decryptPrivateInviteLink } from "@/lib/privateInviteLinkVault";
import { classifyChannelGeoConfidence } from "@/lib/channelGeoQuality";

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
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "10");
  const statusFilter = searchParams.get("status") || "all";
  const qualityFilter = searchParams.get("quality") || "all";
  const riskFilter = searchParams.get("risk") || "all";
  const search = searchParams.get("search") || "";
  const offset = (page - 1) * limit;

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
          ti.last_verified_at AS telegram_last_verified_at,ti.last_username_changed_at,
          ti.last_failure_code AS telegram_failure_code,ti.last_failure_reason AS telegram_failure_reason`
      : `, NULL AS telegram_identity_chat_id,NULL AS telegram_current_username,NULL AS telegram_previous_username,
          NULL AS bot_member_status,NULL AS bot_can_post,NULL AS telegram_last_verified_at,
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
  const { response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const { id, action } = await request.json();
    const normalizedAction = action === "deny" ? "reject" : action === "approve" ? "activate" : action;

    // Fetch channel and owner details
    const [rows]: any = await pool.query(
      `SELECT c.title, c.username, c.chat_id, c.channel_type, c.audience_continents, u.telegram_id
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

    if (normalizedAction === "activate") {
      const privacySchema = await getChannelPrivacySchema();
      const tracking = await onboardPrivateChannelTracking({
        channelId: id,
        chatId: channel.chat_id,
        channelType: channel.channel_type === "private" ? "private" : "public",
        schema: privacySchema,
      });
      if (channel.channel_type === "private" && tracking.status !== "active") {
        return NextResponse.json({
          error: "Private channel activation requires a verified MTProto tracking-account membership.",
          tracking,
        }, { status: 409 });
      }
      await pool.query(
        `UPDATE channels
         SET status = ?,
             is_deleted = FALSE,
             paused_reason = NULL,
             suggested_fix = NULL,
             failure_reason = NULL,
             health_status = 'healthy',
             health_checked_at = NOW(),
             reactivated_at = NOW()
         WHERE id = ?`,
        [status, id]
      );
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
    } else if (normalizedAction === "delete") {
      await pool.query("UPDATE channels SET status = ?, is_deleted = TRUE, paused_reason = 'Deleted by admin.', suggested_fix = NULL WHERE id = ?", [status, id]);
      await clearPrivateTrackingAssignment(id, await getChannelPrivacySchema());
    } else {
      await pool.query("UPDATE channels SET status = ?, paused_reason = ?, suggested_fix = ? WHERE id = ?", [
        status,
        status === "paused" ? "Paused by admin." : null,
        status === "paused" ? "Contact support or reactivate after fixing channel access." : null,
        id,
      ]);
    }

    // Send Telegram Notification
    const channelLabel = channel.username ? `@${escapeTelegramHtml(channel.username)}` : "your private channel";
    const message = normalizedAction === "activate"
      ? `✅ <b>Channel Approved!</b>\n\nYour channel <b>${escapeTelegramHtml(channel.title)}</b> (${channelLabel}) has been approved and is now active in the advertisements network.`
      : `❌ <b>Channel Rejected</b>\n\nUnfortunately, your channel <b>${escapeTelegramHtml(channel.title)}</b> (${channelLabel}) was not approved for monetization at this time.`;

    if (normalizedAction === "activate" || normalizedAction === "reject") {
      await sendTelegramMessage(channel.telegram_id, message, { parse_mode: "HTML" });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Admin Channels Update Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
