import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { getAuthenticatedAdmin } from "@/lib/adminAuth";
import { recordAdminActionAudit } from "@/lib/campaignLifecycle";
import { recordAutomationAudit } from "@/lib/approvalAutomation";
import { sendTelegramMessage } from "@/lib/telegram";
import { getMiniAppPublisherCpmSettings, maxPublisherCpm, normalizeMiniAppCpmMode, validateAdvertiserCpmBid } from "@/lib/miniappPublisherCpmEngine";
import {
  MINIAPP_CREATIVE_CATEGORIES,
  categorySettingKey,
  getMiniAppCategoryCpmAdjustments,
  normalizeMiniAppCategories,
  requiredMiniAppCategoryCpm,
  type MiniAppCreativeCategory,
} from "@/lib/miniappCreativeCategories";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

async function safeNotify(telegramId: unknown, message: string) {
  if (!telegramId) return;
  try {
    await sendTelegramMessage(String(telegramId), message);
  } catch {
    // Best-effort notification.
  }
}

function parseJsonArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

type MiniAppRewardedCampaignRow = RowDataPacket & {
  id: number;
  advertiser_id: number;
  campaign_name: string;
  advertiser_cpm_bid: string | number | null;
  admin_cpm: string | number | null;
  required_cpm: string | number | null;
  categories: unknown;
};

type OwnerRow = RowDataPacket & {
  telegram_id: string | number | null;
};

export async function GET(request: Request) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "all";
  const params: string[] = [];
  let where = "WHERE 1=1";
  if (status !== "all") {
    where += " AND c.status = ?";
    params.push(status);
  }

  const [rows] = await pool.query(
    `SELECT
      c.*,
      u.username,
      u.first_name,
      u.last_name,
      COALESCE(u.advertiser_trust_level, 'new') as advertiser_trust_level,
      COALESCE((SELECT SUM(atx.amount) FROM advertiser_transactions atx WHERE atx.user_id = c.advertiser_id AND atx.type = 'debit'), 0) as advertiser_total_spend,
      COALESCE((SELECT COUNT(*) FROM miniapp_rewarded_campaigns h WHERE h.advertiser_id = c.advertiser_id AND h.status IN ('approved', 'completed')), 0) as advertiser_approved_campaigns,
      COALESCE((SELECT COUNT(*) FROM miniapp_rewarded_campaigns h WHERE h.advertiser_id = c.advertiser_id AND h.status = 'rejected'), 0) as advertiser_rejected_campaigns,
      COALESCE((SELECT COUNT(*) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 0) as impressions,
      COALESCE((SELECT SUM(i.cost) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 0) as spend,
      COALESCE((SELECT SUM(i.publisher_revenue) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 0) as publisher_revenue,
      COALESCE((SELECT SUM(i.ads_galaxy_revenue) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 0) as ads_galaxy_revenue,
      COALESCE((SELECT SUM(i.reserve_revenue) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id), 0) as reserve_revenue,
      COALESCE((SELECT AVG(i.quality_factor) FROM miniapp_internal_ad_impressions i WHERE i.campaign_id = c.id AND i.quality_factor IS NOT NULL), 0) as avg_quality_factor,
      COALESCE((SELECT SUM(ds.ads_galaxy_fee) FROM miniapp_daily_stats ds WHERE ds.network_name = 'AdsGalaxyInternal'), 0) as platform_fees
     FROM miniapp_rewarded_campaigns c
     LEFT JOIN users u ON c.advertiser_id = u.id
     ${where}
     ORDER BY c.created_at DESC
     LIMIT 200`,
    params
  );

  const categoryAdjustments = await getMiniAppCategoryCpmAdjustments();
  return NextResponse.json({ campaigns: rows, category_adjustments: categoryAdjustments });
}

export async function PATCH(request: Request) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const id = Number(body.id);
    const action = cleanText(body.action);
    const moderationNotes = cleanText(body.moderation_notes);
    const adminCpm = body.admin_cpm === undefined ? null : Number(body.admin_cpm);
    const cpmMode = normalizeMiniAppCpmMode(body.cpm_mode);
    const fixedPublisherCpm = body.fixed_publisher_cpm === undefined || body.fixed_publisher_cpm === "" ? null : Number(body.fixed_publisher_cpm);

    if (action === "update_category_adjustment") {
      const category = MINIAPP_CREATIVE_CATEGORIES.find((item) => item === cleanText(body.category)) as MiniAppCreativeCategory | undefined;
      const value = Number(body.value);
      if (!category || !Number.isFinite(value) || value < 0) {
        return NextResponse.json({ error: "Valid category and non-negative adjustment are required" }, { status: 400 });
      }
      await pool.query(
        "INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
        [categorySettingKey(category), value.toFixed(2)]
      );
      await recordAdminActionAudit({
        adminId: admin.id,
        action: "miniapp_category_adjustment_update",
        entityType: "setting",
        entityId: 0,
        reason: "admin_update_category_cpm_adjustment",
        metadata: { admin_username: admin.username, category, value },
      });
      return NextResponse.json({ success: true, category_adjustments: await getMiniAppCategoryCpmAdjustments() });
    }

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Valid campaign id is required" }, { status: 400 });
    }

    const [beforeRows] = await pool.query<MiniAppRewardedCampaignRow[]>("SELECT * FROM miniapp_rewarded_campaigns WHERE id = ?", [id]);
    if (beforeRows.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const selectedCategories = normalizeMiniAppCategories(parseJsonArray(beforeRows[0].categories));
    const [[owner]] = await pool.query<OwnerRow[]>("SELECT telegram_id FROM users WHERE id = ?", [beforeRows[0].advertiser_id]);

    if (action === "approve") {
      const approvalCpm = Number.isFinite(adminCpm)
        ? Number(adminCpm)
        : Number(beforeRows[0].admin_cpm || beforeRows[0].advertiser_cpm_bid || beforeRows[0].required_cpm || 0);
      if (!Number.isFinite(approvalCpm) || approvalCpm <= 0) {
        return NextResponse.json({ error: "Admin CPM must be greater than 0 for approval" }, { status: 400 });
      }
      const cpmSettings = await getMiniAppPublisherCpmSettings();
      validateAdvertiserCpmBid(approvalCpm, cpmSettings);
      const categoryCpm = await requiredMiniAppCategoryCpm(selectedCategories);
      if (approvalCpm < categoryCpm.required_cpm) {
        return NextResponse.json({ error: `Admin CPM must be at least $${categoryCpm.required_cpm.toFixed(2)} for the selected categories` }, { status: 400 });
      }
      if (cpmMode === "fixed") {
        if (!Number.isFinite(fixedPublisherCpm) || Number(fixedPublisherCpm) <= 0) {
          return NextResponse.json({ error: "Fixed Publisher CPM must be greater than 0" }, { status: 400 });
        }
        if (Number(fixedPublisherCpm) > maxPublisherCpm(approvalCpm, cpmSettings)) {
          return NextResponse.json({ error: "Fixed Publisher CPM exceeds the publisher share ceiling" }, { status: 400 });
        }
      }
      await pool.query(
        `UPDATE miniapp_rewarded_campaigns
         SET status = 'approved',
           admin_cpm = ?,
           advertiser_cpm_bid = CASE WHEN advertiser_cpm_bid > 0 THEN advertiser_cpm_bid ELSE ? END,
           cpm_mode = ?,
           fixed_publisher_cpm = ?,
           required_cpm = ?,
           creative_review_status = 'approved',
           creative_review_notes = ?,
           approved_at = COALESCE(approved_at, NOW())
          WHERE id = ?`,
        [approvalCpm, approvalCpm, cpmMode, cpmMode === "fixed" ? fixedPublisherCpm : null, categoryCpm.required_cpm, moderationNotes || null, id]
      );
      await safeNotify(owner?.telegram_id, `✅ Your Mini App ad "${beforeRows[0].campaign_name}" was approved.`);
    } else if (action === "reject") {
      await pool.query("UPDATE miniapp_rewarded_campaigns SET status = 'rejected', creative_review_status = 'rejected', creative_review_notes = ? WHERE id = ?", [moderationNotes || null, id]);
      await safeNotify(owner?.telegram_id, `❌ Your Mini App ad "${beforeRows[0].campaign_name}" was rejected.`);
    } else if (action === "require_changes") {
      await pool.query("UPDATE miniapp_rewarded_campaigns SET status = 'changes_required', creative_review_status = 'changes_required', creative_review_notes = ? WHERE id = ?", [moderationNotes || "Creative changes required", id]);
      await safeNotify(owner?.telegram_id, `⚠️ Your Mini App ad "${beforeRows[0].campaign_name}" requires changes.\n\n${moderationNotes || "Creative changes required"}`);
    } else if (action === "pause") {
      const [pauseResult] = await pool.query<any>("UPDATE miniapp_rewarded_campaigns SET status = 'paused' WHERE id = ? AND status = 'approved'", [id]);
      if (pauseResult.affectedRows === 0) {
        return NextResponse.json({ error: "Campaign must be in approved status to pause" }, { status: 400 });
      }
    } else if (action === "resume") {
      if (beforeRows[0].status !== "paused") {
        return NextResponse.json({ error: "Campaign must be paused to resume" }, { status: 400 });
      }
      const [resumeResult] = await pool.query<any>("UPDATE miniapp_rewarded_campaigns SET status = 'approved' WHERE id = ? AND status = 'paused' AND remaining_budget > 0", [id]);
      if (resumeResult.affectedRows === 0) {
        return NextResponse.json({ error: "Campaign has no remaining budget — top up before resuming" }, { status: 400 });
      }
    } else if (action === "update_cpm") {
      if (!Number.isFinite(adminCpm) || Number(adminCpm) <= 0) {
        return NextResponse.json({ error: "Admin CPM must be greater than 0" }, { status: 400 });
      }
      const cpmSettings = await getMiniAppPublisherCpmSettings();
      validateAdvertiserCpmBid(Number(adminCpm), cpmSettings);
      const categoryCpm = await requiredMiniAppCategoryCpm(selectedCategories);
      if (Number(adminCpm) < categoryCpm.required_cpm) {
        return NextResponse.json({ error: `Admin CPM must be at least $${categoryCpm.required_cpm.toFixed(2)} for the selected categories` }, { status: 400 });
      }
      if (cpmMode === "fixed") {
        if (!Number.isFinite(fixedPublisherCpm) || Number(fixedPublisherCpm) <= 0) {
          return NextResponse.json({ error: "Fixed Publisher CPM must be greater than 0" }, { status: 400 });
        }
        if (Number(fixedPublisherCpm) > maxPublisherCpm(Number(adminCpm), cpmSettings)) {
          return NextResponse.json({ error: "Fixed Publisher CPM exceeds the publisher share ceiling" }, { status: 400 });
        }
      }
      await pool.query(
        "UPDATE miniapp_rewarded_campaigns SET admin_cpm = ?, required_cpm = ?, cpm_mode = ?, fixed_publisher_cpm = ? WHERE id = ?",
        [adminCpm, categoryCpm.required_cpm, cpmMode, cpmMode === "fixed" ? fixedPublisherCpm : null, id]
      );
    } else if (action === "edit") {
      const campaign_name = cleanText(body.campaign_name) || beforeRows[0].campaign_name;
      const title = cleanText(body.title);
      const description = cleanText(body.description);
      const image_url = cleanText(body.image_url) || null;
      const landing_url = cleanText(body.landing_url) || null;
      const cta_text = cleanText(body.cta_text) || null;
      const title_color = cleanText(body.title_color) || null;
      const body_color = cleanText(body.body_color) || null;
      const categories = Array.isArray(body.categories) && body.categories.length > 0 ? JSON.stringify(body.categories) : beforeRows[0].categories;
      const countries = Array.isArray(body.countries) && body.countries.length > 0 ? JSON.stringify(body.countries) : null;
      const languages = Array.isArray(body.languages) && body.languages.length > 0 ? JSON.stringify(body.languages) : null;
      const vpn_policy = cleanText(body.vpn_policy) || "allow_all";
      const device_policy = cleanText(body.device_policy) || "all";
      const os_policy = cleanText(body.os_policy) || "all";
      const start_at = body.start_at || null;
      const end_at = body.end_at || null;
      const daily_budget_limit = body.daily_budget_limit ? Number(body.daily_budget_limit) : null;
      const frequency_cap_per_user = body.frequency_cap_per_user ? Number(body.frequency_cap_per_user) : null;
      await pool.query(
        `UPDATE miniapp_rewarded_campaigns
         SET campaign_name = ?, title = ?, description = ?, image_url = ?, landing_url = ?,
             cta_text = ?, title_color = ?, body_color = ?, categories = ?, countries = ?,
             languages = ?, vpn_policy = ?, device_policy = ?, os_policy = ?,
             start_at = ?, end_at = ?, daily_budget_limit = ?, frequency_cap_per_user = ?
         WHERE id = ?`,
        [campaign_name, title, description, image_url, landing_url,
         cta_text, title_color, body_color, categories, countries,
         languages, vpn_policy, device_policy, os_policy,
         start_at, end_at, daily_budget_limit, frequency_cap_per_user, id]
      );
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const [afterRows] = await pool.query<MiniAppRewardedCampaignRow[]>("SELECT * FROM miniapp_rewarded_campaigns WHERE id = ?", [id]);
    await recordAdminActionAudit({
      adminId: admin.id,
      action: `miniapp_rewarded_${action}`,
      entityType: "miniapp_rewarded_campaign",
      entityId: id,
      reason: `admin_${action}`,
      metadata: {
        admin_username: admin.username,
        previous_state: beforeRows[0],
        new_state: afterRows[0],
      },
    });
    await recordAutomationAudit({
      actorType: "admin",
      actorId: admin.id,
      action: `manual_miniapp_rewarded_${action}`,
      entityType: "miniapp_rewarded_campaign",
      entityId: id,
      decision: action,
      reason: moderationNotes || `admin_${action}`,
      metadata: { admin_username: admin.username },
    });

    return NextResponse.json({ success: true, campaign: afterRows[0] });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update Mini App rewarded campaign" }, { status: 500 });
  }
}
