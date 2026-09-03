import { NextResponse } from "next/server";
/* eslint-disable @typescript-eslint/no-explicit-any -- legacy admin campaign payloads are not schema-generated */
import pool from "@/lib/db";
import { checkAdminAuth, requireAdminPermission } from "@/lib/adminAuth";
import { adminResumeCampaign, recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { recordAutomationAudit } from "@/lib/approvalAutomation";
import { sendTelegramMessage } from "@/lib/telegram";
import { applyMiniAppCampaignMetrics, getMiniAppCampaignMetricsByIds } from "@/lib/miniappCampaignMetrics";

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
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "10");
  const statusFilter = searchParams.get("status") || "all";
  const trustFilter = searchParams.get("trust") || "all";
  const search = searchParams.get("search") || "";
  const offset = (page - 1) * limit;

  try {
    const innerQuery = `
      SELECT
        c.id, 'campaign' AS campaign_kind, c.user_id, c.name, c.type,
        c.status, c.budget, c.total_budget, c.daily_budget_limit, c.cpm, c.quality_score, c.quality_tier,
        c.link, c.message_text, c.image_url, c.button_text, c.category,
        c.continents, c.countries, c.languages, c.vpn_policy, c.device_policy, c.os_policy,
        c.start_at, c.end_at, c.frequency_cap_per_user, c.direct_placement_mode,
        c.direct_inventory_scope, c.direct_inventory_metadata, c.created_at, c.rejection_reason,
        u.first_name, u.last_name, u.username, u.telegram_id,
        COALESCE(u.advertiser_trust_level, 'new') AS advertiser_trust_level,
        (SELECT COUNT(*) FROM campaigns ch WHERE ch.user_id = c.user_id AND ch.status IN ('active','completed','budget_exhausted')) AS advertiser_approved_campaigns,
        (SELECT COUNT(*) FROM campaigns ch WHERE ch.user_id = c.user_id AND ch.status = 'rejected') AS advertiser_rejected_campaigns,
        CASE WHEN c.type = 'broadcast' THEN 'BOT' ELSE 'CHANNEL' END AS type_label,
        c.budget AS remaining_budget,
        CASE WHEN COALESCE(c.budget, 0) <= 0 THEN TRUE ELSE FALSE END AS budget_exhausted,
        CASE WHEN c.type = 'broadcast'
          THEN COALESCE((SELECT SUM(bd.cost) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.status = 'sent'), 0)
          ELSE COALESCE(c.channel_spend, 0)
        END AS spend,
        CASE WHEN c.type = 'broadcast'
          THEN COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.status = 'sent'), 0)
          ELSE COALESCE((SELECT SUM(cp.views) FROM campaign_posts cp WHERE cp.campaign_id = c.id), 0)
        END AS impressions,
        CASE WHEN c.type = 'broadcast' THEN 0
          ELSE COALESCE((SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.campaign_id = c.id), 0)
        END AS clicks,
        CASE WHEN c.type <> 'broadcast' AND COALESCE((SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.campaign_id = c.id), 0) > 0
          THEN COALESCE(c.channel_spend, 0) / (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.campaign_id = c.id)
          ELSE 0
        END AS average_cpc,
        0 AS requires_re_moderation
      FROM campaigns c LEFT JOIN users u ON c.user_id = u.id
      UNION ALL
      SELECT
        m.id, 'miniapp' AS campaign_kind, m.advertiser_id AS user_id, m.campaign_name AS name, 'miniapp_rewarded' AS type,
        CASE WHEN m.status = 'approved' THEN 'active' ELSE m.status END AS status,
        m.budget, m.budget AS total_budget, m.daily_budget_limit, m.advertiser_cpm_bid AS cpm, m.quality_score, m.quality_tier,
        m.landing_url AS link, m.description AS message_text, m.image_url, m.cta_text AS button_text, m.categories AS category,
        NULL AS continents, m.countries, m.languages, m.vpn_policy, m.device_policy, m.os_policy,
        m.start_at, m.end_at, m.frequency_cap_per_user, m.direct_placement_mode,
        m.direct_inventory_scope, m.direct_inventory_metadata, m.created_at, m.creative_review_notes AS rejection_reason,
        u.first_name, u.last_name, u.username, u.telegram_id,
        COALESCE(u.advertiser_trust_level, 'new') AS advertiser_trust_level,
        (SELECT COUNT(*) FROM campaigns ch WHERE ch.user_id = m.advertiser_id AND ch.status IN ('active','completed','budget_exhausted')) AS advertiser_approved_campaigns,
        (SELECT COUNT(*) FROM campaigns ch WHERE ch.user_id = m.advertiser_id AND ch.status = 'rejected') AS advertiser_rejected_campaigns,
        'MINI APP' AS type_label,
        m.remaining_budget,
        FALSE AS budget_exhausted,
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

    if (search) {
      whereClause += ` AND (name LIKE ? OR message_text LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR username LIKE ? OR telegram_id LIKE ?)`;
      const s = `%${search}%`;
      queryParams.push(s, s, s, s, s, s);
    }

    const query = `SELECT * FROM (${innerQuery}) AS combined${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    // Counting must not execute the expensive delivery, impression, click and
    // advertiser-history subqueries used by the ten visible result rows.
    const countInnerQuery = `
      SELECT c.status,c.name,c.message_text,u.first_name,u.last_name,u.username,u.telegram_id,
        COALESCE(u.advertiser_trust_level,'new') advertiser_trust_level
      FROM campaigns c LEFT JOIN users u ON u.id=c.user_id
      UNION ALL
      SELECT CASE WHEN m.status='approved' THEN 'active' ELSE m.status END status,
        m.campaign_name name,m.description message_text,u.first_name,u.last_name,u.username,u.telegram_id,
        COALESCE(u.advertiser_trust_level,'new') advertiser_trust_level
      FROM miniapp_rewarded_campaigns m LEFT JOIN users u ON u.id=m.advertiser_id
    `;
    const countQuery = `SELECT COUNT(*) AS total FROM (${countInnerQuery}) AS combined${whereClause}`;

    const [rows]: any = await pool.query(query, [...queryParams, limit, offset]);
    const [[countRow]]: any = await pool.query(countQuery, queryParams);
    const miniAppMetrics = await getMiniAppCampaignMetricsByIds(
      rows.filter((row: any) => row.campaign_kind === "miniapp").map((row: any) => row.id),
    );
    const normalizedRows = rows.map((row: any) => row.campaign_kind === "miniapp"
      ? applyMiniAppCampaignMetrics(row, miniAppMetrics)
      : row);

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
    const [campaignRows]: any = await pool.query(
      "SELECT c.name, u.telegram_id FROM campaigns c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?",
      [id]
    );
    const campaign = campaignRows[0];

    if (action === "reject") {
      await pool.query("UPDATE campaigns SET status = 'rejected', rejection_reason = ? WHERE id = ?", [rejectionReason || null, id]);
      await safeNotify(campaign?.telegram_id, `❌ Your campaign "${campaign.name}" was rejected after review.${rejectionReason ? `\n\n${rejectionReason}` : ""}`);
      await recordAutomationAudit({ actorType: "admin", action: "manual_campaign_reject", entityType: "campaign", entityId: id, decision: "reject", reason: rejectionReason || "admin_manual_review" });
      await recordAdminActionAudit({ adminId: admin?.id, action: "campaign_reject", entityType: "campaign", entityId: id, reason: rejectionReason || "admin_manual_review" });
      return NextResponse.json({ success: true });
    }

    if (action === "approve") {
      await pool.query("UPDATE campaigns SET status = 'active' WHERE id = ?", [id]);
      await safeNotify(campaign?.telegram_id, `✅ Your campaign "${campaign.name}" was approved and is active.`);
      await recordAutomationAudit({ actorType: "admin", action: "manual_campaign_approve", entityType: "campaign", entityId: id, decision: "approve", reason: "admin_manual_review" });
      await recordAdminActionAudit({ adminId: admin?.id, action: "campaign_approve", entityType: "campaign", entityId: id, reason: "admin_manual_review" });
      return NextResponse.json({ success: true });
    }

    if (action === "resume") {
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
