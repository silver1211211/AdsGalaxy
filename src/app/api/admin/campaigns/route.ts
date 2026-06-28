import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";
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
        c.status, c.budget, c.cpm, c.quality_score, c.quality_tier,
        c.link, c.message_text, c.image_url, c.button_text, c.category,
        c.continents, c.created_at,
        u.first_name, u.last_name, u.username, u.telegram_id,
        COALESCE(u.advertiser_trust_level, 'new') AS advertiser_trust_level,
        (SELECT COALESCE(SUM(amount),0) FROM advertiser_transactions atx WHERE atx.user_id = c.user_id AND atx.type = 'debit') AS advertiser_total_spend,
        (SELECT COUNT(*) FROM campaigns ch WHERE ch.user_id = c.user_id AND ch.status IN ('active','completed','budget_exhausted')) AS advertiser_approved_campaigns,
        (SELECT COUNT(*) FROM campaigns ch WHERE ch.user_id = c.user_id AND ch.status = 'rejected') AS advertiser_rejected_campaigns
      FROM campaigns c LEFT JOIN users u ON c.user_id = u.id
      UNION ALL
      SELECT
        m.id, 'miniapp' AS campaign_kind, m.advertiser_id AS user_id, m.campaign_name AS name, 'miniapp_rewarded' AS type,
        CASE WHEN m.status = 'approved' THEN 'active' ELSE m.status END AS status,
        m.budget, m.advertiser_cpm_bid AS cpm, m.quality_score, m.quality_tier,
        m.landing_url AS link, m.description AS message_text, m.image_url, m.cta_text AS button_text, '' AS category,
        '[]' AS continents, m.created_at,
        u.first_name, u.last_name, u.username, u.telegram_id,
        COALESCE(u.advertiser_trust_level, 'new') AS advertiser_trust_level,
        (SELECT COALESCE(SUM(amount),0) FROM advertiser_transactions atx WHERE atx.user_id = m.advertiser_id AND atx.type = 'debit') AS advertiser_total_spend,
        (SELECT COUNT(*) FROM campaigns ch WHERE ch.user_id = m.advertiser_id AND ch.status IN ('active','completed','budget_exhausted')) AS advertiser_approved_campaigns,
        (SELECT COUNT(*) FROM campaigns ch WHERE ch.user_id = m.advertiser_id AND ch.status = 'rejected') AS advertiser_rejected_campaigns
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
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, action } = await request.json();
    const [campaignRows]: any = await pool.query(
      "SELECT c.name, u.telegram_id FROM campaigns c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?",
      [id]
    );
    const campaign = campaignRows[0];

    if (action === "reject") {
      await pool.query("UPDATE campaigns SET status = 'rejected' WHERE id = ?", [id]);
      await safeNotify(campaign?.telegram_id, `❌ Your campaign "${campaign.name}" was rejected after review.`);
      await recordAutomationAudit({ actorType: "admin", action: "manual_campaign_reject", entityType: "campaign", entityId: id, decision: "reject", reason: "admin_manual_review" });
      return NextResponse.json({ success: true });
    }

    if (action === "approve") {
      await pool.query("UPDATE campaigns SET status = 'active' WHERE id = ?", [id]);
      await safeNotify(campaign?.telegram_id, `✅ Your campaign "${campaign.name}" was approved and is active.`);
      await recordAutomationAudit({ actorType: "admin", action: "manual_campaign_approve", entityType: "campaign", entityId: id, decision: "approve", reason: "admin_manual_review" });
      return NextResponse.json({ success: true });
    }

    if (action === "resume") {
      await adminResumeCampaign(id);
      await recordAdminActionAudit({
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
