import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { normalizeCampaignCategory } from "@/lib/campaignCategories";
import { normalizeAdvertiserTargeting, targetingDbParams } from "@/lib/advertiserTargeting";
import { calculateCampaignQualityScore } from "@/lib/advertiserTrust";
import { validatePostbackUrl } from "@/lib/conversionTracking";
import { normalizeMarketplaceType, publicSelectionMetadata, recordMarketplaceEvent, validateDirectPlacementTargets } from "@/lib/publisherMarketplace";
import { evaluateCampaignAutomation } from "@/lib/approvalAutomation";
import { requireUserWritesAllowed } from "@/lib/productionSafety";
import { columnExists } from "@/lib/schemaGuards";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { replaceCampaignExclusions } from "@/lib/campaignInventoryExclusions";
import { validateTotalBudget } from "@/lib/campaignBudget";
import { safeQueueAdvertiserOnboarding } from "@/lib/supportMessages";
import { validateCampaignCpmBid } from "@/lib/campaignCpmSettings";
import { hasRestrictedClickCreativeContent } from "@/lib/campaignCreative";

export async function POST(request: Request) {
  try {
    const blocked = await requireUserWritesAllowed();
    if (blocked) return blocked;

    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    const formData = await request.formData();
    
    const name = String(formData.get("name") || "").trim();
    const campaignTitle = String(formData.get("campaign_title") || "").trim();
    const parse_mode = formData.get("parse_mode") as string;
    const message_text = String(formData.get("message_text") || "");
    const link = formData.get("link") as string;
    const postbackUrl = validatePostbackUrl(formData.get("postback_url"));
    const button_text = formData.get("button_text") as string;
    const type = formData.get("type") as string;
    const budget = validateTotalBudget(formData.get("budget"));
    const cpm = parseFloat(formData.get("cpm") as string);
    const category = normalizeCampaignCategory(formData.get("category"));
    const continents = formData.get("continents") as string;
    const imageFile = formData.get("image") as File | null;
    const directPlacementMode = String(formData.get("direct_placement_mode") || "network") === "direct" ? "direct" : "network";
    const directInventoryScope = String(formData.get("direct_inventory_scope") || "network");
    const directInventoryType = normalizeMarketplaceType(formData.get("direct_inventory_type") || (type === "broadcast" ? "bot" : "channel"));
    const directInventoryIds = JSON.parse(String(formData.get("direct_inventory_ids") || "[]"));
    const directSelectionMetadata = publicSelectionMetadata({
      direct_placement_mode: directPlacementMode,
      direct_inventory_scope: directInventoryScope,
      direct_categories: formData.get("direct_categories"),
      direct_countries: formData.get("direct_countries"),
      direct_languages: formData.get("direct_languages"),
    });
    const targeting = normalizeAdvertiserTargeting({
      countries: formData.get("countries"),
      languages: formData.get("languages"),
      vpn_policy: formData.get("vpn_policy"),
      device_policy: formData.get("device_policy"),
      os_policy: formData.get("os_policy"),
      start_at: formData.get("start_at"),
      end_at: formData.get("end_at"),
      daily_budget_limit: formData.get("daily_budget_limit"),
      frequency_cap_per_user: formData.get("frequency_cap_per_user"),
    }, budget);

    // 1. Validation
    if (!name || !campaignTitle || !message_text.trim() || !link || !budget || !cpm) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (campaignTitle.length < 3) {
      return NextResponse.json({ error: "Campaign title must be at least 3 characters" }, { status: 400 });
    }

    if (campaignTitle.length > 255) {
      return NextResponse.json({ error: "Campaign title exceeds 255 characters" }, { status: 400 });
    }

    if (message_text.length > 1000) {
      return NextResponse.json({ error: "Message text exceeds 1000 characters" }, { status: 400 });
    }

    await validateCampaignCpmBid(type, cpm);

    // Click-type restriction: No usernames or links in text
    if (type === "clicks") {
      if (hasRestrictedClickCreativeContent(campaignTitle) || hasRestrictedClickCreativeContent(message_text)) {
        return NextResponse.json({ 
          error: "Click campaigns cannot contain usernames (@) or links in the campaign title or message text. Use the button for your link."
        }, { status: 400 });
      }
    }

    // 2. Handle Image Upload to External API
    let imageUrl = null;
    if (imageFile) {
      if (imageFile.size > 1024 * 1024) {
        return NextResponse.json({ error: "Image size cannot exceed 1MB" }, { status: 400 });
      }

      const imgApiFormData = new FormData();
      imgApiFormData.append("action", "upload");
      imgApiFormData.append("image", imageFile);

      try {
        const imgRes = await fetch(process.env.IMG_API_ENDPOINT!, {
          method: "POST",
          body: imgApiFormData,
        });
        const imgData = await imgRes.json();
        if (imgData.success) {
          imageUrl = imgData.data.url;
        } else {
          console.error("Image Upload Error:", imgData.message);
        }
      } catch (err) {
        console.error("Image API Connection Error:", err);
      }
    }

    // 3. Create Campaign (Transaction)
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [balanceResult] = await conn.query<ResultSetHeader>(
        `UPDATE users
         SET ad_balance = ad_balance - ?
         WHERE id = ? AND ad_balance >= ?`,
        [budget, user.id, budget]
      );
      if (balanceResult.affectedRows !== 1) {
        await conn.rollback();
        return NextResponse.json({ error: "Insufficient ad balance. Please deposit funds." }, { status: 400 });
      }

      const [userRows] = await conn.query<Array<RowDataPacket & {
        advertiser_trust_level: string | null;
        telegram_id: string | number | null;
      }>>(
        "SELECT advertiser_trust_level, telegram_id FROM users WHERE id = ?",
        [user.id]
      );

      const quality = await calculateCampaignQualityScore(user.id, {
        name,
        message_text,
        image_url: imageUrl,
        link,
        button_text,
        budget,
        cpm,
        category,
        countries: formData.get("countries"),
      }, conn);
      const directTargets = await validateDirectPlacementTargets({
        mode: directPlacementMode,
        scope: directInventoryScope,
        inventoryType: directInventoryType,
        inventoryIds: Array.isArray(directInventoryIds) ? directInventoryIds : [],
        cpm,
      }, conn);

      // Insert campaign
      const [result]: any = await conn.query(
        `INSERT INTO campaigns (
          user_id, name, campaign_title, parse_mode, message_text, image_url, link, postback_url, button_text, type,
          budget, total_budget, cpm, category, quality_score, quality_tier, quality_metadata,
          continents, countries, languages, vpn_policy,
          device_policy, os_policy, start_at, end_at, daily_budget_limit,
          frequency_cap_per_user, direct_placement_mode, direct_inventory_scope,
          direct_inventory_metadata, status
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          user.id,
          name,
          campaignTitle,
          parse_mode,
          message_text,
          imageUrl,
          link,
          postbackUrl,
          button_text,
          type,
          budget,
          budget,
          cpm,
          category,
          quality.score,
          quality.tier,
          JSON.stringify(quality.metadata),
          continents,
          ...targetingDbParams(targeting),
          directPlacementMode,
          directInventoryScope,
          JSON.stringify({
            ...directSelectionMetadata,
            inventory_type: directInventoryType,
            required_cpm: directTargets.requiredCpm,
          }),
        ]
      );

      for (const inventoryId of directTargets.ids) {
        await conn.query(
          "INSERT INTO campaign_direct_inventory_targets (campaign_type, campaign_id, inventory_type, inventory_id) VALUES ('campaign', ?, ?, ?)",
          [result.insertId, directInventoryType, inventoryId]
        );
        await recordMarketplaceEvent({
          advertiserId: user.id,
          inventoryType: directInventoryType,
          inventoryId,
          eventType: "selection",
          metadata: { campaign_type: "campaign", campaign_id: result.insertId },
        }, conn);
      }

      await replaceCampaignExclusions(conn, {
        campaignType: "campaign",
        campaignId: result.insertId,
        inventoryType: type === "broadcast" ? "bot" : "channel",
        identifiers: formData.get("excluded_inventory"),
      });

      await evaluateCampaignAutomation({
        campaignType: "campaign",
        campaignId: result.insertId,
        advertiserId: user.id,
        advertiserTelegramId: userRows[0]?.telegram_id,
        advertiserTrustLevel: userRows[0]?.advertiser_trust_level,
        qualityScore: quality.score,
        qualityTier: quality.tier,
        category,
        destinationUrl: link,
        creativeText: message_text,
      }, conn);

      // Create transaction record
      await conn.query(
        "INSERT INTO advertiser_transactions (user_id, amount, type, description) VALUES (?, ?, 'debit', ?)",
        [user.id, budget, `Campaign Creation: ${name}`]
      );

      await safeQueueAdvertiserOnboarding(user.id, conn);

      await conn.commit();
      return NextResponse.json({ success: true, id: result.insertId });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

  } catch (error: any) {
    console.error("Create Campaign Error:", error);
    return NextResponse.json({ error: error.message || "Failed to create campaign" }, { status: getAuthErrorStatus(error) });
  }
}

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const hasCampaignUpdatedAt = await columnExists(pool, "campaigns", "updated_at");
    const hasCampaignPostViews = await columnExists(pool, "campaign_posts", "views");
    const hasBroadcastDeliveryCost = await columnExists(pool, "broadcast_deliveries", "cost");
    const campaignPostImpressionsExpr = hasCampaignPostViews
      ? "COALESCE((SELECT SUM(cp.views) FROM campaign_posts cp WHERE cp.campaign_id = c.id), 0)"
      : "COALESCE((SELECT COUNT(*) FROM campaign_posts cp WHERE cp.campaign_id = c.id), 0)";
    const campaignPostTodayImpressionsExpr = hasCampaignPostViews
      ? "COALESCE((SELECT SUM(cp.views) FROM campaign_posts cp WHERE cp.campaign_id = c.id AND cp.created_at >= CURDATE()), 0)"
      : "COALESCE((SELECT COUNT(*) FROM campaign_posts cp WHERE cp.campaign_id = c.id AND cp.created_at >= CURDATE()), 0)";
    const campaignPostYesterdayImpressionsExpr = hasCampaignPostViews
      ? "COALESCE((SELECT SUM(cp.views) FROM campaign_posts cp WHERE cp.campaign_id = c.id AND cp.created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND cp.created_at < CURDATE()), 0)"
      : "COALESCE((SELECT COUNT(*) FROM campaign_posts cp WHERE cp.campaign_id = c.id AND cp.created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND cp.created_at < CURDATE()), 0)";
    const broadcastSpendExpr = hasBroadcastDeliveryCost
      ? "COALESCE((SELECT SUM(bd.cost) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.status = 'sent'), 0)"
      : "0";
    const broadcastTodaySpendExpr = hasBroadcastDeliveryCost
      ? "COALESCE((SELECT SUM(bd.cost) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.status = 'sent' AND bd.created_at >= CURDATE()), 0)"
      : "0";
    const channelTodaySpendExpr = `(COALESCE((SELECT SUM(l.advertiser_debit) FROM channel_settlement_ledger l WHERE l.campaign_id=c.id AND l.created_at>=CURDATE()),0)
      + COALESCE((SELECT SUM(d.advertiser_debit) FROM channel_advertiser_debits d WHERE d.campaign_id=c.id AND d.created_at>=CURDATE()),0))`;
    const campaignUpdatedAtExpr = hasCampaignUpdatedAt ? "c.updated_at" : "c.created_at";

    const [rows]: any = await pool.query(
      `SELECT id, name, campaign_title, parse_mode, message_text, image_url, link, postback_url, button_text, rejection_reason,
         type, budget, total_budget, cpm, category, continents, countries, languages, vpn_policy,
         device_policy, os_policy, start_at, end_at, daily_budget_limit,
         frequency_cap_per_user, direct_placement_mode, direct_inventory_scope,
         direct_inventory_metadata, status, paused_at, resume_locked_until,
         completed_at, budget_exhausted_at, pause_reason, auto_reactivate,
         created_at, ${campaignUpdatedAtExpr} AS updated_at,
         budget as remaining_budget,
         CASE
           WHEN type = 'broadcast' THEN COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id), 0)
           ELSE ${campaignPostImpressionsExpr}
         END as impressions,
         CASE
           WHEN type = 'broadcast' THEN COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.created_at >= CURDATE()), 0)
           ELSE ${campaignPostTodayImpressionsExpr}
         END as today_impressions,
         CASE
           WHEN type = 'broadcast' THEN COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND bd.created_at < CURDATE()), 0)
           ELSE ${campaignPostYesterdayImpressionsExpr}
         END as yesterday_impressions,
         CASE
           WHEN type = 'broadcast' THEN 0
           ELSE COALESCE((SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.campaign_id = c.id), 0)
         END as clicks,
         CASE
           WHEN type = 'broadcast' THEN ${broadcastSpendExpr}
           ELSE COALESCE(c.channel_spend, 0)
         END as spend,
         CASE
           WHEN type = 'broadcast' THEN ${broadcastTodaySpendExpr}
           ELSE ${channelTodaySpendExpr}
         END as today_spend,
         CASE WHEN COALESCE(c.budget, 0) <= 0 THEN TRUE ELSE FALSE END AS budget_exhausted,
         CASE WHEN COALESCE(c.daily_budget_limit, 0) > 0 AND (
           CASE WHEN type = 'broadcast' THEN ${broadcastTodaySpendExpr}
           ELSE ${channelTodaySpendExpr} END
         ) >= c.daily_budget_limit THEN TRUE ELSE FALSE END AS daily_cap_reached,
         CASE
           WHEN type = 'broadcast' THEN COALESCE((SELECT COUNT(DISTINCT bd.bot_id) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id), 0)
           ELSE COALESCE((SELECT COUNT(DISTINCT cp.channel_id) FROM campaign_posts cp WHERE cp.campaign_id = c.id), 0)
         END as active_publishers,
         CASE
           WHEN type = 'broadcast' THEN 0
           ELSE COALESCE((SELECT COUNT(DISTINCT cp.channel_id) FROM campaign_posts cp WHERE cp.campaign_id = c.id), 0)
         END as active_channels,
         CASE
           WHEN type = 'broadcast' THEN COALESCE((SELECT COUNT(DISTINCT bd.bot_id) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id), 0)
           ELSE 0
         END as active_bots,
         CASE
           WHEN (
             CASE WHEN type = 'broadcast' THEN COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id), 0)
             ELSE ${campaignPostImpressionsExpr} END
           ) > 0
           THEN (
             CASE WHEN type = 'broadcast' THEN 0
             ELSE COALESCE((SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.campaign_id = c.id), 0) END
           ) / (
             CASE WHEN type = 'broadcast' THEN COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id), 1)
             ELSE ${campaignPostImpressionsExpr} END
           ) * 100
           ELSE 0
         END as ctr,
         CASE
           WHEN (
             CASE WHEN type = 'broadcast' THEN COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id), 0)
             ELSE ${campaignPostImpressionsExpr} END
           ) > 0
           THEN (
             CASE WHEN type = 'broadcast' THEN ${broadcastSpendExpr}
             ELSE COALESCE(c.channel_spend, 0) END
           ) / (
             CASE WHEN type = 'broadcast' THEN COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id), 1)
             ELSE ${campaignPostImpressionsExpr} END
           ) * 1000
           ELSE 0
         END as average_cpm,
         CASE
           WHEN type != 'broadcast' AND COALESCE((SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.campaign_id = c.id), 0) > 0
           THEN COALESCE(c.channel_spend, 0) / COALESCE((SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.campaign_id = c.id), 1)
           ELSE 0
         END as average_cpc,
         CASE
           WHEN (
             CASE WHEN type = 'broadcast' THEN ${broadcastSpendExpr}
             ELSE COALESCE(c.channel_spend, 0) END
             + COALESCE(c.budget, 0)
           ) > 0
           THEN (
             CASE WHEN type = 'broadcast' THEN ${broadcastSpendExpr}
             ELSE COALESCE(c.channel_spend, 0) END
           ) / (
             CASE WHEN type = 'broadcast' THEN ${broadcastSpendExpr}
             ELSE COALESCE(c.channel_spend, 0) END
             + COALESCE(c.budget, 0)
           ) * 100
           ELSE 0
         END as completion_percent
       FROM campaigns c WHERE c.user_id = ? ORDER BY c.created_at DESC`,
      [user.id]
    );

    return NextResponse.json(rows, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error: any) {
    console.error("Fetch Campaigns Error:", error);
    return NextResponse.json({ error: "Unable to load campaigns right now" }, { status: getAuthErrorStatus(error) });
  }
}
