import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { normalizeCampaignCategory } from "@/lib/campaignCategories";
import { serializeExplicitCampaignAudience } from "@/lib/channelAudience";
import { normalizeAdvertiserTargeting, targetingDbParams } from "@/lib/advertiserTargeting";
import { calculateCampaignQualityScore } from "@/lib/advertiserTrust";
import { validatePostbackUrl } from "@/lib/conversionTracking";
import { normalizeMarketplaceType, publicSelectionMetadata, recordMarketplaceEvent, validateDirectPlacementTargets } from "@/lib/publisherMarketplace";
import { evaluateCampaignAutomation } from "@/lib/approvalAutomation";
import { requireUserWritesAllowed } from "@/lib/productionSafety";
import { columnExists } from "@/lib/schemaGuards";
import { assertCampaignCreationSchemaReady, CampaignSchemaNotReadyError } from "@/lib/campaignCreationReadiness";
import type { RowDataPacket } from "mysql2/promise";
import { replaceCampaignExclusions } from "@/lib/campaignInventoryExclusions";
import { validateTotalBudget } from "@/lib/campaignBudget";
import { safeQueueAdvertiserOnboarding } from "@/lib/supportMessages";
import { validateCampaignCpmBid } from "@/lib/campaignCpmSettings";
import { hasRestrictedClickCreativeContent } from "@/lib/campaignCreative";
import {
  CampaignCreatePublicError,
  classifyCampaignCreateFailure,
  publicCampaignValidationError,
  validateCampaignObjective,
  validateCampaignText,
} from "@/lib/campaignCreationValidation";
import { executeCampaignCreationTransaction } from "@/lib/campaignCreationTransaction";

function campaignCreateErrorResponse(error: any) {
  const authStatus = getAuthErrorStatus(error);
  if (authStatus !== 500) {
    return NextResponse.json({ error: String(error?.message || "Authentication failed") }, { status: authStatus });
  }
  const failure = classifyCampaignCreateFailure(error);
  return NextResponse.json(failure.body, { status: failure.status });
}

export async function POST(request: Request) {
  try {
    const blocked = await requireUserWritesAllowed();
    if (blocked) return blocked;

    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    const formData = await request.formData();
    
    const name = String(formData.get("name") || "").trim();
    const campaignTitle = String(formData.get("campaign_title") || "").trim();
    const parse_mode = "html";
    const message_text = String(formData.get("message_text") || "");
    const link = formData.get("link") as string;
    const postbackUrl = validatePostbackUrl(formData.get("postback_url"));
    const button_text = formData.get("button_text") as string;
    const type = validateCampaignObjective(formData.get("type"));
    const budget = validateTotalBudget(formData.get("budget"));
    const submittedCpm = parseFloat(String(formData.get("cpm") || "0"));
    const submittedCpc = parseFloat(String(formData.get("cpc") || formData.get("cpm") || "0"));
    const cpc = type === "clicks" ? submittedCpc : 0;
    const cpm = type === "clicks" ? cpc : submittedCpm;
    const category = normalizeCampaignCategory(formData.get("category"));
    let continents = String(formData.get("continents") || "");
    if (type !== "broadcast") {
      try {
        continents = serializeExplicitCampaignAudience(continents);
      } catch (error) {
        throw new CampaignCreatePublicError(
          "INVALID_TARGETING",
          error instanceof Error ? error.message : "Target audience is invalid."
        );
      }
    }
    const imageFile = formData.get("image") as File | null;
    const directPlacementMode = String(formData.get("direct_placement_mode") || "network") === "direct" ? "direct" : "network";
    const directInventoryScope = String(formData.get("direct_inventory_scope") || "network");
    const directInventoryType = normalizeMarketplaceType(formData.get("direct_inventory_type") || (type === "broadcast" ? "bot" : "channel"));
    let directInventoryIds: unknown;
    try {
      directInventoryIds = JSON.parse(String(formData.get("direct_inventory_ids") || "[]"));
    } catch {
      throw new CampaignCreatePublicError("INVALID_TARGETING", "Direct inventory selection is invalid.");
    }
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

    // 1. Complete request validation (before upload or database mutation)
    validateCampaignText({ name, campaignTitle, messageText: message_text, link, buttonText: button_text });

    await validateCampaignCpmBid(type, type === "clicks" ? cpc : cpm);

    // Click-type restriction: No usernames or links in text
    if (type === "clicks") {
      if (hasRestrictedClickCreativeContent(campaignTitle) || hasRestrictedClickCreativeContent(message_text)) {
        return NextResponse.json({ 
          error: "Click campaigns cannot contain usernames (@) or links in the campaign title or message text. Use the button for your link."
        }, { status: 400 });
      }
    }

    const conn = await pool.getConnection();
    try {
      await assertCampaignCreationSchemaReady(conn);
    } catch (error) {
      conn.release();
      throw error;
    }
    conn.release();

    // 2. Optional image upload. Established behavior permits text-only campaigns.
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
          console.error("Campaign image upload was rejected by the provider");
        }
      } catch (err) {
        console.error("Campaign image upload provider was unavailable");
      }
    }

    // 3. Create Campaign (Transaction)
    const transactionConnection = await pool.getConnection();
    try {
      const [userRows] = await transactionConnection.query<Array<RowDataPacket & {
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
      }, transactionConnection);
      const directTargets = await validateDirectPlacementTargets({
        mode: directPlacementMode,
        scope: directInventoryScope,
        inventoryType: directInventoryType,
        inventoryIds: Array.isArray(directInventoryIds) ? directInventoryIds : [],
        cpm,
      }, transactionConnection);

      const creation = await executeCampaignCreationTransaction({
        conn: transactionConnection,
        userId: user.id,
        budget,
        description: `Campaign Creation: ${name}`,
        createCampaign: async (conn) => {
          // Insert campaign
          const [result]: any = await conn.query(
        `INSERT INTO campaigns (
          user_id, name, campaign_title, parse_mode, message_text, image_url, link, postback_url, button_text, type,
          budget, total_budget, cpm, cpc, category, quality_score, quality_tier, quality_metadata,
          continents, countries, languages, vpn_policy,
          device_policy, os_policy, start_at, end_at, daily_budget_limit,
          frequency_cap_per_user, direct_placement_mode, direct_inventory_scope,
          direct_inventory_metadata, status
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
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
          cpc,
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

          await safeQueueAdvertiserOnboarding(user.id, conn);
          return Number(result.insertId);
        },
      });

      return NextResponse.json(creation);
    } finally {
      transactionConnection.release();
    }

  } catch (error: any) {
    if (error instanceof CampaignSchemaNotReadyError) {
      console.error("Campaign schema readiness check failed", { missingCount: error.missing.length });
    } else if (!(error instanceof CampaignCreatePublicError) && !publicCampaignValidationError(error)) {
      console.error("Campaign creation failed", { errorType: error?.constructor?.name || "UnknownError" });
    }
    return campaignCreateErrorResponse(error);
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
         type,
         CASE WHEN type = 'broadcast' THEN GREATEST(COALESCE(budget, 0), 0) ELSE budget END AS budget,
         total_budget, cpm, cpc, category, continents, countries, languages, vpn_policy,
         device_policy, os_policy, start_at, end_at, daily_budget_limit,
         frequency_cap_per_user, direct_placement_mode, direct_inventory_scope,
         direct_inventory_metadata,
         CASE
           WHEN type = 'broadcast' AND status = 'active' AND (
             ROUND(GREATEST(COALESCE(cpm, 0), 0) / 1000, 8) <= 0
             OR budget < ROUND(GREATEST(COALESCE(cpm, 0), 0) / 1000, 8)
           ) THEN 'budget_exhausted'
           ELSE status
         END AS status,
         paused_at, resume_locked_until,
         completed_at, budget_exhausted_at, pause_reason, auto_reactivate,
         created_at, ${campaignUpdatedAtExpr} AS updated_at,
         CASE WHEN type = 'broadcast' THEN GREATEST(COALESCE(budget, 0), 0) ELSE budget END as remaining_budget,
         CASE
           WHEN type = 'broadcast' THEN COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.status = 'sent'), 0)
           ELSE ${campaignPostImpressionsExpr}
         END as impressions,
         CASE
           WHEN type = 'broadcast' THEN COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.status = 'sent' AND bd.created_at >= CURDATE()), 0)
           ELSE ${campaignPostTodayImpressionsExpr}
         END as today_impressions,
         CASE
           WHEN type = 'broadcast' THEN COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.status = 'sent' AND bd.created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY) AND bd.created_at < CURDATE()), 0)
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
         CASE
           WHEN type = 'broadcast' THEN (
             ROUND(GREATEST(COALESCE(cpm, 0), 0) / 1000, 8) <= 0
             OR budget < ROUND(GREATEST(COALESCE(cpm, 0), 0) / 1000, 8)
           )
           ELSE COALESCE(c.budget, 0) <= 0
         END AS budget_exhausted,
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
             CASE WHEN type = 'broadcast' THEN COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.status = 'sent'), 0)
             ELSE ${campaignPostImpressionsExpr} END
           ) > 0
           THEN (
             CASE WHEN type = 'broadcast' THEN 0
             ELSE COALESCE((SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.campaign_id = c.id), 0) END
           ) / (
             CASE WHEN type = 'broadcast' THEN COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.status = 'sent'), 1)
             ELSE ${campaignPostImpressionsExpr} END
           ) * 100
           ELSE 0
         END as ctr,
         CASE
           WHEN (
             CASE WHEN type = 'broadcast' THEN COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.status = 'sent'), 0)
             ELSE ${campaignPostImpressionsExpr} END
           ) > 0
           THEN (
             CASE WHEN type = 'broadcast' THEN ${broadcastSpendExpr}
             ELSE COALESCE(c.channel_spend, 0) END
           ) / (
             CASE WHEN type = 'broadcast' THEN COALESCE((SELECT COUNT(*) FROM broadcast_deliveries bd WHERE bd.campaign_id = c.id AND bd.status = 'sent'), 1)
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
