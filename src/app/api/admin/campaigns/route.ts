import { NextResponse } from "next/server";
/* eslint-disable @typescript-eslint/no-explicit-any -- legacy admin campaign payloads are not schema-generated */
import pool from "@/lib/db";
import { isStandardChannelReport, getChannelReportingMetrics, channelMetricPayload } from "@/lib/channelReporting";
import { checkAdminAuth, requireAdminPermission } from "@/lib/adminAuth";
import { adminResumeCampaign, recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { recordAutomationAudit } from "@/lib/approvalAutomation";
import { sendTelegramMessage } from "@/lib/telegram";
import { applyMiniAppCampaignMetrics, getMiniAppCampaignMetricsByIds } from "@/lib/miniappCampaignMetrics";
import { parseAdminPagination } from "@/lib/adminPagination";
import { mainCampaignDisplayNumberSql, mainCampaignScopeSql } from "@/lib/silverCampaignControl";
import { enqueueCampaignNotification } from "@/lib/platformNotifications";
import { getAiStudioSettings } from "@/lib/aiPromotionStudio/config";
import type { RowDataPacket } from "mysql2/promise";
import { createApprovedCampaignCreativeRevision, loadPendingCampaignCreativeRevision } from "@/lib/campaignCreativeRevision";
import {SMART_REACH_POLICY_VERSION} from "@/lib/channelSmartReachConfiguration";

async function safeNotify(telegramId: unknown, message: string) {
  if (!telegramId) return;
  try {
    await sendTelegramMessage(String(telegramId), message);
  } catch {
    // Best-effort notification.
  }
}

export async function GET(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const { page, limit, offset } = parseAdminPagination(searchParams, { defaultLimit: 10 });
  const statusFilter = searchParams.get("status") || "all";
  const trustFilter = searchParams.get("trust") || "all";
  const search = searchParams.get("search") || "";
  const userIdFilter = searchParams.get("userId") || searchParams.get("user_id") || "";
  const aiOnly = searchParams.get("aiOnly") === "true" || searchParams.get("ai_only") === "1";

  try {
    let aiAdvertiserId: number | null = null;
    if (aiOnly) {
      const studioSettings = await getAiStudioSettings().catch(() => null);
      if (studioSettings?.advertiserUserId) {
        aiAdvertiserId = Number(studioSettings.advertiserUserId);
      }
    }
    const innerQuery = `
      SELECT
        c.id, ${mainCampaignDisplayNumberSql("c")} AS main_display_number, 'campaign' AS campaign_kind, c.campaign_kind AS source_campaign_kind, c.teaser_mode, c.teaser_enabled, c.user_id, c.name, c.type,
        c.status, c.budget, c.total_budget, c.daily_budget_limit, c.cpm, c.quality_score, c.quality_tier,
        c.link, c.message_text, c.image_url, c.button_text, c.category,
        c.continents, c.countries, c.languages, c.vpn_policy, c.device_policy, c.os_policy,
        c.start_at, c.end_at, c.frequency_cap_per_user, c.direct_placement_mode,
        c.direct_inventory_scope, c.direct_inventory_metadata, c.created_at, c.rejection_reason,
        u.first_name, u.last_name, u.username, u.telegram_id,
        COALESCE(u.advertiser_trust_level, 'new') AS advertiser_trust_level,
        0 AS advertiser_approved_campaigns,
        0 AS advertiser_rejected_campaigns,
        CASE WHEN c.type = 'broadcast' THEN 'BOT' ELSE 'CHANNEL' END AS type_label,
        c.budget AS remaining_budget,
        CASE WHEN COALESCE(c.budget, 0) <= 0 THEN TRUE ELSE FALSE END AS budget_exhausted,
        COALESCE(c.channel_spend,0) AS channel_spend,
        0 AS spend,
        0 AS impressions,
        0 AS clicks,
        0 AS average_cpc,
        0 AS requires_re_moderation
      FROM campaigns c LEFT JOIN users u ON c.user_id = u.id WHERE ${mainCampaignScopeSql("c")}
      UNION ALL
      SELECT
        m.id, m.id AS main_display_number, 'miniapp' AS campaign_kind, NULL AS source_campaign_kind, NULL AS teaser_mode, 0 AS teaser_enabled, m.advertiser_id AS user_id, m.campaign_name AS name, 'miniapp_rewarded' AS type,
        CASE WHEN m.status = 'approved' THEN 'active' ELSE m.status END AS status,
        m.budget, m.budget AS total_budget, m.daily_budget_limit, m.advertiser_cpm_bid AS cpm, m.quality_score, m.quality_tier,
        m.landing_url AS link, m.description AS message_text, m.image_url, m.cta_text AS button_text, m.categories AS category,
        NULL AS continents, m.countries, m.languages, m.vpn_policy, m.device_policy, m.os_policy,
        m.start_at, m.end_at, m.frequency_cap_per_user, m.direct_placement_mode,
        m.direct_inventory_scope, m.direct_inventory_metadata, m.created_at, m.creative_review_notes AS rejection_reason,
        u.first_name, u.last_name, u.username, u.telegram_id,
        COALESCE(u.advertiser_trust_level, 'new') AS advertiser_trust_level,
        0 AS advertiser_approved_campaigns,
        0 AS advertiser_rejected_campaigns,
        'MINI APP' AS type_label,
        m.remaining_budget,
        FALSE AS budget_exhausted,
        0 AS channel_spend,
        0 AS spend,
        0 AS impressions,
        0 AS clicks,
        0 AS average_cpc,
        m.requires_re_moderation
      FROM miniapp_rewarded_campaigns m LEFT JOIN users u ON m.advertiser_id = u.id
    `;

    const queryParams: any[] = [];
    let whereClause = " WHERE 1=1";

    if (statusFilter !== "all") {
      whereClause += " AND status = ?";
      queryParams.push(statusFilter);
    }

    if (trustFilter !== "all") {
      whereClause += " AND advertiser_trust_level = ?";
      queryParams.push(trustFilter);
    }

    if (aiOnly) {
      if (aiAdvertiserId) {
        whereClause += " AND campaign_kind = 'campaign' AND (user_id = ? OR id IN (SELECT campaign_id FROM ai_creative_memory WHERE campaign_id IS NOT NULL))";
        queryParams.push(aiAdvertiserId);
      } else {
        whereClause += " AND campaign_kind = 'campaign' AND id IN (SELECT campaign_id FROM ai_creative_memory WHERE campaign_id IS NOT NULL)";
      }
    } else if (userIdFilter) {
      whereClause += " AND user_id = ?";
      queryParams.push(userIdFilter);
    }

    if (search) {
      whereClause += ` AND (name LIKE ? OR message_text LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR username LIKE ? OR telegram_id LIKE ?)`;
      const s = `%${search}%`;
      queryParams.push(s, s, s, s, s, s);
    }

    const query = `SELECT * FROM (${innerQuery}) AS combined${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    // Counting must not execute the expensive delivery, impression, click and
    // advertiser-history subqueries used by the ten visible result rows.
    const countInnerQuery = `
      SELECT c.id, c.status,c.name,c.message_text,u.first_name,u.last_name,u.username,u.telegram_id,
        COALESCE(u.advertiser_trust_level,'new') advertiser_trust_level,
        c.user_id,
        'campaign' AS campaign_kind
      FROM campaigns c LEFT JOIN users u ON u.id=c.user_id WHERE ${mainCampaignScopeSql("c")}
      UNION ALL
      SELECT m.id, CASE WHEN m.status='approved' THEN 'active' ELSE m.status END status,
        m.campaign_name name,m.description message_text,u.first_name,u.last_name,u.username,u.telegram_id,
        COALESCE(u.advertiser_trust_level,'new') advertiser_trust_level,
        m.advertiser_id AS user_id,
        'miniapp' AS campaign_kind
      FROM miniapp_rewarded_campaigns m LEFT JOIN users u ON u.id=m.advertiser_id
    `;
    const countQuery = `SELECT COUNT(*) AS total FROM (${countInnerQuery}) AS combined${whereClause}`;

    const [[rows], [countRows]]: any = await Promise.all([
      pool.query(query, [...queryParams, limit, offset]),
      pool.query(countQuery, queryParams),
    ]);
    const countRow = countRows[0] || { total: 0 };
    const advertiserIds = [...new Set(rows.map((row: any) => Number(row.user_id)))];
    const standardIds = rows.filter((row: any) => row.campaign_kind === "campaign").map((row: any) => Number(row.id));
    const miniAppIds = rows.filter((row: any) => row.campaign_kind === "miniapp").map((row: any) => Number(row.id));
    const [historyRows, deliveryRows, postRows, clickRows, billingRows, miniAppMetrics]: any = await Promise.all([
      advertiserIds.length ? pool.query(
        `SELECT user_id,
           SUM(status IN ('active','completed','budget_exhausted')) approved,
           SUM(status='rejected') rejected
         FROM campaigns WHERE user_id IN (?) GROUP BY user_id`, [advertiserIds]
      ).then(([result]) => result) : [],
      standardIds.length ? pool.query(
        `SELECT campaign_id,COALESCE(SUM(cost),0) spend,COUNT(*) impressions
         FROM broadcast_deliveries WHERE status='sent' AND campaign_id IN (?) GROUP BY campaign_id`, [standardIds]
      ).then(([result]) => result) : [],
      standardIds.length ? pool.query(
        `SELECT campaign_id,COALESCE(SUM(views),0) impressions,
           COALESCE(SUM(CASE WHEN delivery_confirmed_at IS NOT NULL AND delivery_failed_at IS NULL THEN views ELSE 0 END),0) growth_impressions
         FROM campaign_posts WHERE campaign_id IN (?) GROUP BY campaign_id`, [standardIds]
      ).then(([result]) => result) : [],
      standardIds.length ? pool.query(
        `SELECT c.id campaign_id,COUNT(DISTINCT cc.id) actual_clicks,
           COALESCE(MAX(CASE WHEN caa.active=1 AND caa.metric='clicks' AND caa.adjustment_mode='baseline' THEN caa.quantity ELSE 0 END),0) recovery_clicks,
           GREATEST(COUNT(DISTINCT cc.id),COALESCE(MAX(CASE WHEN caa.active=1 AND caa.metric='clicks' AND caa.adjustment_mode='baseline' THEN caa.quantity ELSE 0 END),0)) clicks
         FROM campaigns c LEFT JOIN campaign_clicks cc ON cc.campaign_id=c.id
         LEFT JOIN campaign_analytics_adjustments caa ON caa.campaign_id=c.id
         WHERE c.id IN (?) GROUP BY c.id`, [standardIds]
      ).then(([result]) => result) : [],
      standardIds.length ? pool.query(
        `SELECT campaign_id,SUM(billable_views) billable_views FROM (
           SELECT campaign_id,SUM(units) billable_views FROM channel_advertiser_debits
           WHERE settlement_type='view' AND campaign_id IN (?) GROUP BY campaign_id
           UNION ALL
           SELECT l.campaign_id,SUM(l.new_units) FROM channel_settlement_ledger l
           LEFT JOIN channel_fraud_billing_adjustments a ON a.settlement_ledger_id=l.id
           WHERE l.settlement_type='view' AND a.id IS NULL AND l.campaign_id IN (?) GROUP BY l.campaign_id
         ) charged GROUP BY campaign_id`, [standardIds,standardIds]
      ).then(([result]) => result) : [],
      getMiniAppCampaignMetricsByIds(miniAppIds),
    ]);
    const indexed = (items: any[], key: string) => new Map(items.map((item) => [Number(item[key]), item]));
    const historyByUser = indexed(historyRows, "user_id");
    const deliveryByCampaign = indexed(deliveryRows, "campaign_id");
    const postsByCampaign = indexed(postRows, "campaign_id");
    const clicksByCampaign = indexed(clickRows, "campaign_id");
    const billingByCampaign = indexed(billingRows, "campaign_id");
    const growthIds = rows.filter((row: any) => row.source_campaign_kind === "channel_growth").map((row: any) => Number(row.id));
    const [growthRows]: any = growthIds.length ? await pool.query(
      `SELECT campaign_id,COUNT(*) subscribers,COALESCE(SUM(advertiser_debit),0) spend
       FROM channel_growth_conversions WHERE campaign_id IN (?) AND status='billed' AND fraud_status='clear'
       GROUP BY campaign_id`, [growthIds]) : [[]];
    const growthByCampaign = indexed(growthRows, "campaign_id");
    const normalizedRows = rows.map((row: any) => {
      const history = historyByUser.get(Number(row.user_id));
      const enriched = {
        ...row,
        advertiser_approved_campaigns: Number(history?.approved || 0),
        advertiser_rejected_campaigns: Number(history?.rejected || 0),
      };
      if (row.campaign_kind === "miniapp") return applyMiniAppCampaignMetrics(enriched, miniAppMetrics);
      const delivery = deliveryByCampaign.get(Number(row.id));
      const posts = postsByCampaign.get(Number(row.id));
      if (row.source_campaign_kind === "channel_growth") {
        const growth = growthByCampaign.get(Number(row.id));
        return { ...enriched, spend: Number(growth?.spend || 0), subscriber_spend: Number(growth?.spend || 0),
          verified_subscribers: Number(growth?.subscribers || 0), impressions: Number(posts?.growth_impressions || 0),
          clicks: Number(clicksByCampaign.get(Number(row.id))?.actual_clicks || 0),
          effective_cps: Number(growth?.subscribers || 0) > 0 ? Number(growth?.spend || 0) / Number(growth?.subscribers) : 0 };
      }
      const clicks = Number(clicksByCampaign.get(Number(row.id))?.clicks || 0);
      const billableViews = Number(billingByCampaign.get(Number(row.id))?.billable_views || 0);
      const spend = row.type === "broadcast" ? Number(delivery?.spend || 0) : Number(row.channel_spend || 0);
      return {
        ...enriched,
        spend,
        impressions: row.type === "broadcast"
          ? Number(delivery?.impressions || 0)
          : row.type === "views" ? billableViews : Number(posts?.impressions || 0),
        clicks: row.type === "broadcast" ? 0 : clicks,
        average_cpc: row.type === "broadcast" || clicks === 0 ? 0 : spend / clicks,
      };
    });

    const channelMetrics = await getChannelReportingMetrics(pool, normalizedRows.filter(isStandardChannelReport).map((r: any) => Number(r.id)));
    for (const row of normalizedRows) {
      const metrics = channelMetrics.get(Number(row.id));
      if (isStandardChannelReport(row) && metrics) Object.assign(row, channelMetricPayload(metrics, row.source_campaign_kind === "channel_growth"));
    }

    return NextResponse.json({
      campaigns: normalizedRows,
      total: countRow.total,
      page,
      totalPages: Math.ceil(countRow.total / limit),
    });
  } catch (error: any) {
    console.error("Admin Campaigns API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { admin, response } = await requireAdminPermission("operate");
  if (response) return response;

  try {
    const { id, action, moderation_notes } = await request.json();
    const rejectionReason = String(moderation_notes || "").trim();
    if (action === "reject" && rejectionReason.length < 8) return NextResponse.json({ error: "A rejection reason of at least 8 characters is required", code: "MODERATION_REASON_REQUIRED" }, { status: 400 });
    const [campaignRows]: any = await pool.query(
      `SELECT c.name,c.user_id,c.status,u.telegram_id FROM campaigns c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ? AND ${mainCampaignScopeSql("c")}`,
      [id]
    );
    const campaign = campaignRows[0];
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    if (action === "reject") {
      const conn = await pool.getConnection();
      let cleanupQueued = false;
      try {
        await conn.beginTransaction();
        const [rows] = await conn.query<Array<RowDataPacket & Record<string, unknown>>>(
          `SELECT c.* FROM campaigns c WHERE c.id=? AND ${mainCampaignScopeSql("c")} FOR UPDATE`, [id],
        );
        const current = rows[0];
        if (!current) throw new Error("campaign_not_found");
        const pendingId = Number(current.pending_creative_revision_id || 0);
        const previouslyApproved = Boolean(current.approved_creative_revision_id) || current.status === "active";
        if (pendingId) await conn.query(
          "UPDATE campaign_creative_revisions SET review_status='rejected',reviewed_at=UTC_TIMESTAMP(6),review_reason=? WHERE id=? AND campaign_id=? AND review_status='pending'",
          [rejectionReason, pendingId, id],
        );
        if (previouslyApproved) {
          if (!current.approved_creative_revision_id) {
            const [approvedCopies] = await conn.query<Array<RowDataPacket & {copy_text:string}>>(
              "SELECT copy_text FROM teaser_creatives WHERE campaign_id=? AND active=1 ORDER BY position",[id]);
            const approvedId = await createApprovedCampaignCreativeRevision(conn,{
              campaignId:Number(id),campaign:current,teaserVariants:approvedCopies.map(row=>row.copy_text),
            });
            await conn.query("UPDATE campaigns SET approved_creative_revision_id=? WHERE id=?",[approvedId,id]);
          }
          // New delivery stops in this transaction. Published placements retain
          // billing eligibility until their deletion is authoritatively confirmed.
          await conn.query(
            `UPDATE campaigns SET status='paused',pause_reason='moderation_cleanup',
               rejection_reason=?,pending_creative_revision_id=NULL,status_before_creative_review=NULL,
               telegram_cleanup_status='pending',updated_at=UTC_TIMESTAMP()
             WHERE id=?`, [rejectionReason, id],
          );
          await conn.query(
            `UPDATE campaign_posts SET status='cleanup_pending',cleanup_status='pending'
             WHERE campaign_id=? AND status IN ('active','posted','sent','delete_failed')
               AND delivery_confirmed_at IS NOT NULL AND deleted_at IS NULL`, [id],
          );
          await conn.query(
            `UPDATE teaser_placements SET status='removal_pending',
               removal_requested_at=COALESCE(removal_requested_at,UTC_TIMESTAMP()),
               removal_reason='moderation_rejected'
             WHERE campaign_id=? AND status IN ('active','awaiting_baseline')`, [id],
          );
          await conn.query(
            `UPDATE broadcast_deliveries SET cleanup_status='pending',cleanup_next_retry_at=UTC_TIMESTAMP(6)
             WHERE campaign_id=? AND status='sent' AND telegram_message_id IS NOT NULL
               AND deleted_at IS NULL AND cleanup_status IS NULL`,[id],
          );
          cleanupQueued = true;
        } else {
          await conn.query(
            `UPDATE campaigns SET status='rejected',rejection_reason=?,
               pending_creative_revision_id=NULL,status_before_creative_review=NULL,updated_at=UTC_TIMESTAMP()
             WHERE id=?`, [rejectionReason, id],
          );
        }
        await conn.commit();
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }
      await safeNotify(campaign?.telegram_id, `❌ Your campaign "${campaign.name}" was rejected after review.${rejectionReason ? `\n\n${rejectionReason}` : ""}`);
      await recordAutomationAudit({ actorType: "admin", action: "manual_campaign_reject", entityType: "campaign", entityId: id, decision: "reject", reason: rejectionReason || "admin_manual_review" });
      await recordAdminActionAudit({ adminId: admin?.id, action: "campaign_reject", entityType: "campaign", entityId: id, reason: rejectionReason || "admin_manual_review" });
      return NextResponse.json({ success: true, status: cleanupQueued ? "paused" : "rejected", cleanup_queued: cleanupQueued });
    }

    if (action === "approve") {
      const conn = await pool.getConnection();
      let approvedStatus = "active";
      try {
        await conn.beginTransaction();
        const [rows] = await conn.query<Array<RowDataPacket & Record<string, unknown>>>(
          `SELECT c.* FROM campaigns c WHERE c.id=? AND ${mainCampaignScopeSql("c")} FOR UPDATE`, [id],
        );
        const current = rows[0];
        if (!current) throw new Error("campaign_not_found");
        const pendingId = Number(current.pending_creative_revision_id || 0);
        if (pendingId) {
          const revision = await loadPendingCampaignCreativeRevision(conn, Number(id), pendingId);
          approvedStatus = current.status === "pending" && current.status_before_creative_review === "active" ? "active" : "paused";
          const creative = revision.creative;
          await conn.query(
            `UPDATE campaigns SET campaign_title=?,message_text=?,image_url=?,link=?,button_text=?,
               teaser_mode=?,teaser_cta_key=?,teaser_cpm=?,
               approved_creative_revision_id=?,pending_creative_revision_id=NULL,
               status_before_creative_review=NULL,status=?,
               pause_reason=IF(?='active',NULL,pause_reason),rejection_reason=NULL,updated_at=UTC_TIMESTAMP()
             WHERE id=?`,
            [creative.campaign_title,creative.message_text,creative.image_url,creative.link,creative.button_text,
              creative.teaser_mode,creative.teaser_cta_key,creative.teaser_cpm,pendingId,approvedStatus,approvedStatus,id],
          );
          if (creative.teaser_mode !== "none") {
            for (const [index, copy] of revision.teaserVariants.entries()) await conn.query(
              `INSERT INTO teaser_creatives(campaign_id,copy_text,position,active)
               VALUES(?,?,?,1) ON DUPLICATE KEY UPDATE copy_text=VALUES(copy_text),active=1`,
              [id, copy, index + 1],
            );
            await conn.query("UPDATE teaser_creatives SET active=0 WHERE campaign_id=? AND position>?", [id, revision.teaserVariants.length]);
          }
          await conn.query(
            "UPDATE campaign_creative_revisions SET review_status='approved',reviewed_at=UTC_TIMESTAMP(6) WHERE id=? AND campaign_id=? AND review_status='pending'",
            [pendingId, id],
          );
        } else if (current.status === "pending" && !current.approved_creative_revision_id) {
          const [variants] = await conn.query<Array<RowDataPacket & { copy_text: string }>>(
            "SELECT copy_text FROM teaser_creatives WHERE campaign_id=? AND active=1 ORDER BY position", [id],
          );
          const approvedId = await createApprovedCampaignCreativeRevision(conn, {
            campaignId: Number(id), campaign: current,
            teaserVariants: variants.map(row => row.copy_text),
          });
          await conn.query(
            "UPDATE campaigns SET status='active',approved_creative_revision_id=?,rejection_reason=NULL,updated_at=UTC_TIMESTAMP() WHERE id=? AND status='pending'",
            [approvedId, id],
          );
        } else {
          await conn.rollback();
          return NextResponse.json({ error: "Only a pending creative can be approved. Paused campaigns need a separate resume decision." }, { status: 409 });
        }
        if (current.financial_policy_version === SMART_REACH_POLICY_VERSION) {
          await conn.query(
            "UPDATE campaigns SET status='paused',pause_reason='smart_reach_billing_pending' WHERE id=?",
            [id],
          );
          approvedStatus = "paused";
        }
        await conn.commit();
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }
      if (approvedStatus === "active") await enqueueCampaignNotification(pool, {
        campaignId: Number(id), userId: Number(campaign.user_id), event: "approved", name: campaign.name,
      });
      await recordAutomationAudit({ actorType: "admin", action: "manual_campaign_approve", entityType: "campaign", entityId: id, decision: "approve", reason: "admin_manual_review" });
      await recordAdminActionAudit({ adminId: admin?.id, action: "campaign_approve", entityType: "campaign", entityId: id, reason: "admin_manual_review" });
      return NextResponse.json({ success: true, status: approvedStatus });
    }

    if (action === "resume") {
      const [[state]]: any = await pool.query(
        "SELECT status,pause_reason,pending_creative_revision_id,approved_creative_revision_id,telegram_cleanup_status,rejection_reason FROM campaigns WHERE id=?",[id]);
      const cleanupStillBlocked=state?.pause_reason==='moderation_cleanup' &&
        !(state?.telegram_cleanup_status==='success' && !state?.rejection_reason && state?.approved_creative_revision_id);
      if (cleanupStillBlocked || state?.pending_creative_revision_id) return NextResponse.json(
        {error:"A rejected or pending creative needs a new approved edit before delivery can resume."},{status:409});
      await adminResumeCampaign(id);
      await recordAdminActionAudit({
        adminId: admin?.id,
        action: "campaign_resume_override",
        entityType: "campaign",
        entityId: id,
        reason: "admin_resume_override",
      });
      await safeNotify(campaign?.telegram_id, `✅ Your campaign "${campaign.name}" was restored.`);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    console.error("Admin Campaigns Update Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
