/* eslint-disable @typescript-eslint/no-explicit-any -- legacy campaign payloads are not schema-generated */
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthenticatedUserStatus, getAuthErrorStatus } from "@/lib/auth";
import { serializeCampaignCategories } from "@/lib/campaignCategories";
import { serializeExplicitCampaignAudience } from "@/lib/channelAudience";
import { normalizeAdvertiserTargeting, targetingDbParams } from "@/lib/advertiserTargeting";
import { calculateCampaignQualityScore } from "@/lib/advertiserTrust";
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
import { CACHE_TTL_SECONDS, cacheGetOrSet, invalidateAdvertiserCaches, redisKeys } from "@/lib/redisCache";
import { getGrowthSettings, validateGrowthBudgets, validateGrowthMessageText, verifyGrowthDestination } from "@/lib/channelGrowth";
import { getAdvertiserDiscount } from "@/lib/advertiserDiscount";
import { getChannelUnitPrice } from "@/lib/channelBilling";
import { normalizeTeaserVariants,validateTeaserCpm,validateTeaserCta } from "@/lib/teaser";

function campaignCreateErrorResponse(error: any) {
  const authStatus = getAuthErrorStatus(error);
  if (authStatus !== 500) {
    return NextResponse.json({ error: String(error?.message || "Authentication failed") }, { status: authStatus });
  }
  const failure = classifyCampaignCreateFailure(error);
  return NextResponse.json(failure.body, { status: failure.status });
}

function safeCampaignCreateDiagnosticCode(error: any) {
  const code = String(error?.code || "").toUpperCase();
  return /^[A-Z0-9_]{1,64}$/.test(code) ? code : "UNCLASSIFIED";
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
    const button_text = formData.get("button_text") as string;
    const campaignKind = formData.get("campaign_kind") === "channel_growth" ? "channel_growth" : "channel";
    const type = validateCampaignObjective(formData.get("type"));
    const requestedTeaserMode=String(formData.get("teaser_mode")||"none");
    if(requestedTeaserMode==="standard_plus_teaser")throw new CampaignCreatePublicError("TEASER_STANDALONE_ONLY","Teaser Ads must be created as a separate campaign.");
    const teaserMode=requestedTeaserMode==="teaser_only"?"teaser_only":"none";
    if(type==="clicks"&&teaserMode!=="none")throw new CampaignCreatePublicError("TEASER_VIEWS_ONLY","Teaser is available for Views campaigns only.");
    const teaserEnabled=teaserMode!=="none";
    let teaserVariants:string[]=[];let teaserCta:string|null=null;let teaserCpm:number|null=null;
    if(teaserEnabled){
      teaserVariants=normalizeTeaserVariants(JSON.parse(String(formData.get("teaser_variants")||"[]")));
      teaserCta=validateTeaserCta(formData.get("teaser_cta"));
      const [teaserSettings]=await pool.query<Array<RowDataPacket&{key:string;value:string}>>("SELECT `key`,value FROM settings WHERE `key` IN ('teaser_min_cpm','teaser_max_cpm')");const settings=new Map(teaserSettings.map(row=>[row.key,Number(row.value)]));
      teaserCpm=validateTeaserCpm(formData.get("teaser_cpm"),{min:settings.get("teaser_min_cpm")??0.5,max:settings.get("teaser_max_cpm")??6.5});
    }
    const budget = validateTotalBudget(formData.get("budget"));
    const submittedCpm = parseFloat(String(formData.get("cpm") || "0"));
    const submittedCpc = parseFloat(String(formData.get("cpc") || formData.get("cpm") || "0"));
    const cpc = type === "clicks" ? submittedCpc : 0;
    const cpm = type === "clicks" ? cpc : submittedCpm;
    const category = serializeCampaignCategories(formData.get("category"), 3);
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
    const imageFile = teaserMode==="teaser_only"?null:formData.get("image") as File | null;
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
    if (campaignKind === "channel_growth") {
      try {
        validateGrowthBudgets(budget, targeting.daily_budget_limit);
      } catch (error) {
        throw new CampaignCreatePublicError("INVALID_GROWTH_BUDGET", error instanceof Error ? error.message : "Channel Growth budget is invalid.");
      }
      try {
        validateGrowthMessageText(message_text);
      } catch (error) {
        throw new CampaignCreatePublicError("INVALID_GROWTH_MESSAGE", error instanceof Error ? error.message : "Channel Growth message is invalid.");
      }
    }

    // 1. Complete request validation (before upload or database mutation)
    validateCampaignText({ name, campaignTitle, messageText: message_text, link, buttonText: button_text });

    let growthDestination: Awaited<ReturnType<typeof verifyGrowthDestination>> | null = null;
    let costPerSubscriber: number | null = null;
    if (campaignKind === "channel_growth") {
      const settings = await getGrowthSettings();
      costPerSubscriber = Number(formData.get("cost_per_subscriber"));
      if (!Number.isFinite(costPerSubscriber) || costPerSubscriber < settings.min || costPerSubscriber > settings.max) throw new CampaignCreatePublicError("INVALID_CPS", `Cost per Subscriber must be between $${settings.min.toFixed(2)} and $${settings.max.toFixed(2)}.`);
      growthDestination = await verifyGrowthDestination(String(formData.get("destination_channel") || link));
    } else if (teaserMode !== "teaser_only") {
      await validateCampaignCpmBid(type, type === "clicks" ? cpc : cpm);
    }

    const discount = await getAdvertiserDiscount(pool, user.id);
    const nextBillableUnit = campaignKind === "channel_growth"
      ? Number(costPerSubscriber || 0)
      : teaserMode === "teaser_only"
        ? Number(teaserCpm || 0) / 1000
        : getChannelUnitPrice({
            type,
            cpm,
            cpc,
            discount: type === "clicks" ? discount.cpc_discount : discount.cpm_discount,
          });
    const [walletRows] = await pool.query<Array<RowDataPacket & { ad_balance: string | number }>>(
      "SELECT ad_balance FROM users WHERE id=? LIMIT 1",
      [user.id],
    );
    if (!(nextBillableUnit > 0) || Number(walletRows[0]?.ad_balance || 0) + 1e-10 < nextBillableUnit) {
      throw new CampaignCreatePublicError("INSUFFICIENT_AD_BALANCE", "Ad Balance cannot cover the next billable event.");
    }

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

    // 2. Optional image upload. If selected, the image is part of the creative:
    // never silently create a text-only campaign when storage fails.
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
        if (imgRes.ok && imgData.success && imgData.data?.url) {
          imageUrl = imgData.data.url;
        } else {
          console.error("Campaign image upload was rejected by the provider");
          return NextResponse.json({ error: "Image upload failed. No campaign was created." }, { status: 502 });
        }
      } catch {
        console.error("Campaign image upload provider was unavailable");
        return NextResponse.json({ error: "Image upload is temporarily unavailable. No campaign was created." }, { status: 503 });
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
          user_id, name, campaign_title, parse_mode, message_text, image_url, link, button_text, type, campaign_kind, billing_model, funding_model, cost_per_subscriber, destination_chat_id, growth_tracking_status,
          budget, total_budget, cpm, cpc, teaser_mode, teaser_enabled, teaser_cta_key, teaser_cpm, category, quality_score, quality_tier, quality_metadata,
          continents, countries, languages, vpn_policy,
          device_policy, os_policy, start_at, end_at, daily_budget_limit,
          frequency_cap_per_user, direct_placement_mode, direct_inventory_scope,
          direct_inventory_metadata, status
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'direct_debit', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          user.id,
          name,
          campaignTitle,
          parse_mode,
          message_text,
          imageUrl,
          link,
          button_text,
          type,
          campaignKind,
          campaignKind === "channel_growth" ? "cps" : (type === "clicks" ? "cpc" : "cpm"),
          costPerSubscriber,
          growthDestination?.chatId ?? null,
          campaignKind === "channel_growth" ? "ready" : null,
          budget,
          budget,
          cpm,
          cpc,
          teaserMode,
          teaserEnabled?1:0,
          teaserCta,
          teaserCpm,
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

          for(const [position,copy] of teaserVariants.entries())await conn.query("INSERT INTO teaser_creatives(campaign_id,copy_text,position) VALUES(?,?,?)",[result.insertId,copy,position+1]);

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

      await invalidateAdvertiserCaches(Number(user.id));
      return NextResponse.json(creation);
    } finally {
      transactionConnection.release();
    }

  } catch (error: any) {
    if (error instanceof CampaignSchemaNotReadyError) {
      console.error("Campaign schema readiness check failed", { missingCount: error.missing.length });
    } else if (!(error instanceof CampaignCreatePublicError) && !publicCampaignValidationError(error)) {
      console.error("Campaign creation failed", {
        errorType: error?.constructor?.name || "UnknownError",
        errorCode: safeCampaignCreateDiagnosticCode(error),
      });
    }
    return campaignCreateErrorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUserStatus(initData, { request });
    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit") || 50);
    const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.trunc(requestedLimit))) : 50;
    const rows = await cacheGetOrSet(
      redisKeys.campaignList(Number(user.id), limit),
      CACHE_TTL_SECONDS.CAMPAIGN_LIST,
      async () => {
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
    const broadcastEffectiveCpmExpr = `GREATEST(COALESCE(c.cpm, 0) - COALESCE((
      SELECT CASE WHEN ard.expires_at > UTC_TIMESTAMP() THEN ard.cpm_discount ELSE 0 END
      FROM advertiser_rate_discounts ard WHERE ard.user_id = c.user_id LIMIT 1
    ), 0), 0.01)`;

    const [campaignRows]: any = await pool.query(
          `SELECT id, name, campaign_title, parse_mode, message_text, image_url, link, button_text, rejection_reason,
         type,
         CASE WHEN type = 'broadcast' THEN GREATEST(COALESCE(budget, 0), 0) ELSE budget END AS budget,
         total_budget, cpm, cpc, category, continents, countries, languages, vpn_policy,
         device_policy, os_policy, start_at, end_at, daily_budget_limit,
         frequency_cap_per_user, direct_placement_mode, direct_inventory_scope,
         direct_inventory_metadata,
         CASE
           WHEN type = 'broadcast' AND status = 'active' AND (
             COALESCE(c.cpm, 0) <= 0
             OR budget < ROUND(${broadcastEffectiveCpmExpr} / 1000, 8)
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
             COALESCE(c.cpm, 0) <= 0
             OR budget < ROUND(${broadcastEffectiveCpmExpr} / 1000, 8)
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
       FROM campaigns c WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT ?`,
      [user.id, limit]
    );
    return campaignRows;
      },
    );

    return NextResponse.json(rows, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error: any) {
    console.error("Fetch Campaigns Error:", error);
    return NextResponse.json({ error: "Unable to load campaigns right now" }, { status: getAuthErrorStatus(error) });
  }
}
