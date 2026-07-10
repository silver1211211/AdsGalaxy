import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { checkAdminAuth, requireAdminPermission } from "@/lib/adminAuth";
import { adminResumeCampaign, recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { recordAutomationAudit } from "@/lib/approvalAutomation";
import { sendTelegramMessage } from "@/lib/telegram";

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
        c.continents, c.created_at, c.rejection_reason,
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
          THEN COALESCE((SELECT FLOOR(COUNT(*) / 5) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.status = 'sent'), 0)
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
        m.landing_url AS link, m.description AS message_text, m.image_url, m.cta_text AS button_text, '' AS category,
        '[]' AS continents, m.created_at, m.creative_review_notes AS rejection_reason,
        u.first_name, u.last_name, u.username, u.telegram_id,
        COALESCE(u.advertiser_trust_level, 'new') AS advertiser_trust_level,
        (SELECT COUNT(*) FROM campaigns ch WHERE ch.user_id = m.advertiser_id AND ch.status IN ('active','completed','budget_exhausted')) AS advertiser_approved_campaigns,
        (SELECT COUNT(*) FROM campaigns ch WHERE ch.user_id = m.advertiser_id AND ch.status = 'rejected') AS advertiser_rejected_campaigns,
        'MINI APP' AS type_label,
        m.remaining_budget,
        CASE WHEN COALESCE(m.remaining_budget, 0) <= 0 THEN TRUE ELSE FALSE END AS budget_exhausted,
        COALESCE((SELECT SUM(i.cost) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = m.id), 0) AS spend,
        COALESCE((SELECT COUNT(*) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = m.id), 0) AS impressions,
        COALESCE((SELECT COUNT(*) FROM ad_click_attribution ac WHERE ac.campaign_type = 'miniapp' AND ac.campaign_id = m.id), 0) AS clicks,
        CASE WHEN COALESCE((SELECT COUNT(*) FROM ad_click_attribution ac WHERE ac.campaign_type = 'miniapp' AND ac.campaign_id = m.id), 0) > 0
          THEN COALESCE((SELECT SUM(i.cost) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = m.id), 0)
            / (SELECT COUNT(*) FROM ad_click_attribution ac WHERE ac.campaign_type = 'miniapp' AND ac.campaign_id = m.id)
          ELSE 0
        END AS average_cpc,
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
    const countQuery = `SELECT COUNT(*) AS total FROM (${innerQuery}) AS combined${whereClause}`;

    const [rows]: any = await pool.query(query, [...queryParams, limit, offset]);
    const [[countRow]]: any = await pool.query(countQuery, queryParams);

    return NextResponse.json({
      campaigns: rows,
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
