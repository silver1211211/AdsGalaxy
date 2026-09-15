/* eslint-disable @typescript-eslint/no-explicit-any -- legacy campaign action payloads are not schema-generated */
import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { effectiveBidPerThousand, getAdvertiserDiscount } from "@/lib/advertiserDiscount";
import { getAuthenticatedUser, getAuthenticatedUserStatus, getAuthErrorStatus } from "@/lib/auth";
import { assertCampaignLifecycleColumns } from "@/lib/campaignLifecycle";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { serializeCampaignCategories } from "@/lib/campaignCategories";
import { serializeExplicitCampaignAudience } from "@/lib/channelAudience";
import { normalizeAdvertiserTargeting, targetingDbParams } from "@/lib/advertiserTargeting";
import { replaceCampaignExclusions } from "@/lib/campaignInventoryExclusions";
import { hasRestrictedClickCreativeContent } from "@/lib/campaignCreative";
import { sendTelegramMessage } from "@/lib/telegram";
import { pausableCampaignKind } from "@/lib/campaignPauseLifecycle";
import { invalidateAdvertiserCaches } from "@/lib/redisCache";
import { normalizeTeaserVariants,validateTeaserCpm,validateTeaserCta } from "@/lib/teaser";
import { GROWTH_MIN_TOTAL_BUDGET, validateGrowthBudgets, validateGrowthMessageText } from "@/lib/channelGrowth";
import { deleteActiveCampaignPosts } from "@/lib/campaignPostDeletion";

async function campaignMutationSuccess(userId: number, payload: Record<string, unknown>) {
  // Cache invalidation is fail-open and happens only after the authoritative DB write.
  await invalidateAdvertiserCaches(userId);
  return NextResponse.json(payload);
}

async function safeNotify(telegramId: unknown, message: string) {
  if (!telegramId) return;
  try {
    await sendTelegramMessage(String(telegramId), message);
  } catch {
    // Best-effort notification.
  }
}

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

async function uploadCampaignImage(imageFile: File | null) {
  if (!imageFile || imageFile.size === 0) return null;
  if (imageFile.size > 1024 * 1024) {
    throw new Error("Image size cannot exceed 1MB");
  }
  const endpoint = process.env.IMG_API_ENDPOINT;
  if (!endpoint) throw new Error("Image upload is not configured");

  const imgApiFormData = new FormData();
  imgApiFormData.append("action", "upload");
  imgApiFormData.append("image", imageFile);

  const imgRes = await fetch(endpoint, { method: "POST", body: imgApiFormData, signal: AbortSignal.timeout(10_000) });
  const imgData = await imgRes.json().catch(() => ({}));
  if (!imgData.success || !imgData.data?.url) {
    throw new Error(imgData.message || "Image upload failed");
  }
  return String(imgData.data.url);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUserStatus(initData, { request });

    const [campaignKinds]: any = await pool.query(
      "SELECT type, campaign_kind FROM campaigns WHERE id = ? AND user_id = ? LIMIT 1",
      [id, user.id]
    );
    if (campaignKinds.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    const isBotCampaign = campaignKinds[0].type === "broadcast";
    const [campaignRows]: any = await pool.query(
      isBotCampaign
        ? `SELECT id, name, campaign_title, message_text, image_url, link, button_text,
             type, GREATEST(COALESCE(budget, 0), 0) AS budget, total_budget, channel_spend, funding_model, cpm, category, continents,
             status,
             created_at, updated_at
           FROM campaigns WHERE id = ? AND user_id = ?`
        : `SELECT id, name, campaign_title, parse_mode, message_text, image_url, link, button_text,
             type, campaign_kind, billing_model, funding_model, cost_per_subscriber, destination_channel_id,
             growth_tracking_status, growth_seed_allocated, growth_seed_recovered,
             budget, total_budget, channel_spend, cpm, category, continents, countries, languages, vpn_policy,
             device_policy, os_policy, start_at, end_at, daily_budget_limit,
             frequency_cap_per_user, direct_placement_mode, direct_inventory_scope,teaser_mode,teaser_enabled,teaser_cta_key,teaser_cpm,teaser_paused_at,teaser_resume_locked_until,
             direct_inventory_metadata, status, paused_at, resume_locked_until,
             completed_at, budget_exhausted_at, pause_reason, auto_reactivate,
             created_at, updated_at
           FROM campaigns WHERE id = ? AND user_id = ?`,
      [id, user.id]
    );

    if (campaignRows.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    if (isBotCampaign && campaignRows[0].status === "active") {
      const discount = await getAdvertiserDiscount(pool, user.id);
      const unitPrice = effectiveBidPerThousand(campaignRows[0].cpm, discount.cpm_discount) / 1000;
      if (!(unitPrice > 0) || Number(campaignRows[0].budget || 0) < unitPrice) {
        campaignRows[0].status = "budget_exhausted";
      }
    }

    const campaign = campaignRows[0];
    if(Boolean(campaign.teaser_enabled)||String(campaign.teaser_mode||"none")!=="none"){
      const [creativeRows]=await pool.query<RowDataPacket[]>("SELECT id,copy_text,position,active FROM teaser_creatives WHERE campaign_id=? ORDER BY position",[id]);campaign.teaser_creatives=creativeRows;
      const [teaserStats]=await pool.query<RowDataPacket[]>("SELECT COUNT(DISTINCT tp.id) placements,SUM(tp.status IN ('active','awaiting_baseline')) active_placements,COALESCE(SUM(ts.impression_delta),0) teaser_impressions,COALESCE(SUM(tp.clicks),0) teaser_clicks,COALESCE(SUM(ts.gross_amount),0) teaser_spend FROM teaser_placements tp LEFT JOIN teaser_settlements ts ON ts.placement_id=tp.id WHERE tp.campaign_id=?",[id]);campaign.teaser_stats=teaserStats[0]||{};
      const [variantStats]=await pool.query<RowDataPacket[]>(`SELECT tc.id,tc.copy_text,COUNT(DISTINCT tp.id) placements,COALESCE(SUM(ts.impression_delta),0) impressions,COALESCE(SUM(tp.clicks),0) clicks FROM teaser_creatives tc LEFT JOIN teaser_placements tp ON tp.teaser_creative_id=tc.id LEFT JOIN teaser_settlements ts ON ts.placement_id=tp.id WHERE tc.campaign_id=? GROUP BY tc.id,tc.copy_text,tc.position ORDER BY tc.position LIMIT 5`,[id]);campaign.teaser_variant_stats=variantStats;
    }
    try {
      const [exclusions] = await pool.query<Array<RowDataPacket & { normalized_identifier: string }>>(
        "SELECT normalized_identifier FROM campaign_inventory_exclusions WHERE campaign_type = 'campaign' AND campaign_id = ? AND inventory_type = ? ORDER BY id",
        [id, campaign.type === "broadcast" ? "bot" : "channel"]
      );
      campaign.excluded_inventory = exclusions.map((row) => row.normalized_identifier);
    } catch (error: any) {
      if (error?.code !== "ER_NO_SUCH_TABLE") throw error;
      campaign.excluded_inventory = [];
    }

    // Stats based on campaign type
    let extraData: any = {};

    if (campaign.type === 'broadcast') {
      // Get broadcast summary
      const [broadcastSummary]: any = await pool.query(
        "SELECT COUNT(*) as count, SUM(cost) as total_cost FROM broadcast_deliveries WHERE campaign_id = ? AND status = 'sent'",
        [id]
      );
      
      // Get stats by bot
      const [botStats]: any = await pool.query(
        `SELECT b.bot_name, b.bot_username, 
         COUNT(*) as delivery_count,
         SUM(bd.cost) as total_spent
         FROM broadcast_deliveries bd
         JOIN bots b ON bd.bot_id = b.id
         WHERE bd.campaign_id = ? AND bd.status = 'sent'
         GROUP BY b.id`,
        [id]
      );

      extraData = {
        total_deliveries: broadcastSummary[0].count || 0,
        total_spent: broadcastSummary[0].total_cost || 0,
        broadcast_stats: botStats
      };
    } else {
      // Get total clicks
      const [clickCount]: any = await pool.query(
        "SELECT COUNT(*) as count FROM campaign_clicks WHERE campaign_id = ?",
        [id]
      );

      // Get total views
      const [viewCount]: any = await pool.query(
        "SELECT SUM(views) as count FROM campaign_posts WHERE campaign_id = ?",
        [id]
      );

      // Placement history is not part of standard campaign statistics. Keep a
      // bounded history only for the separate Channel Growth experience.
      let posts: any[] = [];
      if (campaign.campaign_kind === "channel_growth") {
        const [growthPosts]: any = await pool.query(
          `SELECT cp.id,cp.campaign_id,cp.channel_id,cp.status,cp.created_at,
             cp.views,cp.message_id,ch.title channel_title,NULL channel_username,
             (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id=cp.id) post_clicks,
             (SELECT SUM(advertiser_paid) FROM ad_settlements asett WHERE asett.post_id=cp.id) total_paid
           FROM campaign_posts cp
           JOIN channels ch ON cp.channel_id=ch.id
           WHERE cp.campaign_id=?
           ORDER BY cp.created_at DESC
           LIMIT 25`,
          [id],
        );
        posts = growthPosts;
      }

      let growthStats = {};
      if (campaign.campaign_kind === "channel_growth") {
        const [conversionRows]: any = await pool.query(
          "SELECT COUNT(*) AS subscribers_acquired FROM channel_growth_conversions WHERE campaign_id = ? AND status = 'billed' AND fraud_status = 'clear'",
          [id]
        );
        const [pendingRows]: any = await pool.query(
          "SELECT COUNT(*) AS pending_verifications FROM channel_growth_membership_events WHERE campaign_id = ? AND processing_status = 'pending'",
          [id]
        );
        growthStats = {
          subscribers_acquired: Number(conversionRows[0]?.subscribers_acquired || 0),
          pending_verifications: Number(pendingRows[0]?.pending_verifications || 0),
        };
      }

      extraData = {
        total_clicks: clickCount[0].count,
        total_views: viewCount[0].count || 0,
        posts: posts,
        ...growthStats,
      };
    }

    // Standard Channel campaigns load their bounded range chart independently
    // from /statistics so opening the screen never fetches placement history.
    let chartData: any[] = [];
    if (campaign.type === "broadcast" || campaign.campaign_kind === "channel_growth") {
      const chartTable = campaign.type === "broadcast" ? "broadcast_deliveries" : "campaign_clicks";
      const [legacyChart]: any = await pool.query(
        `SELECT DATE(created_at) date,COUNT(*) count
         FROM ${chartTable}
         WHERE campaign_id=? ${campaign.type === "broadcast" ? "AND status='sent'" : ""}
           AND created_at>NOW()-INTERVAL 7 DAY
         GROUP BY DATE(created_at)
         ORDER BY date ASC`,
        [id],
      );
      chartData = legacyChart;
    }

    return NextResponse.json({
      ...campaign,
      budget_cap: Number(campaign.total_budget ?? campaign.budget ?? 0),
      remaining_allowance: Number(campaign.budget ?? 0),
      actual_spend: Number(campaign.total_budget ?? campaign.budget ?? 0) - Number(campaign.budget ?? 0),
      ...extraData,
      chart_data: chartData
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: getAuthErrorStatus(error) });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    const contentType = request.headers.get("content-type") || "";
    const isMultipart = contentType.includes("multipart/form-data");
    const formData = isMultipart ? await request.formData() : null;
    const body = formData ? Object.fromEntries(formData.entries()) : await request.json();
    const { action } = body;

    const [campaignRows]: any = await pool.query(
      `SELECT c.id, c.user_id, c.name, c.campaign_title, c.status, c.budget, c.total_budget, c.cpm, c.cpc,
          c.pause_reason, c.resume_locked_until, c.auto_reactivate, c.type, c.campaign_kind, c.cost_per_subscriber, c.message_text, c.image_url,
          c.link, c.button_text, c.category, c.continents, c.countries, c.languages,
          c.vpn_policy, c.device_policy, c.os_policy, c.start_at, c.end_at, c.daily_budget_limit,
          c.frequency_cap_per_user,c.teaser_mode,c.teaser_enabled,c.teaser_cta_key,c.teaser_cpm,c.teaser_paused_at,c.teaser_resume_locked_until,u.telegram_id
       FROM campaigns c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.id = ? AND c.user_id = ?`,
      [id, user.id]
    );

    if (campaignRows.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const campaign = campaignRows[0];

    if (action === "edit") {
      if (["deleted", "completed", "budget_exhausted"].includes(String(campaign.status))) {
        return NextResponse.json({ error: "This campaign cannot be edited in its current status" }, { status: 400 });
      }

      const nextName = cleanString(body.name || campaign.name);
      const nextTitle = cleanString(body.campaign_title || campaign.campaign_title);
      const nextMessage = String(body.message_text ?? campaign.message_text ?? "");
      const nextLink = cleanString(body.link || campaign.link);
      const nextButtonText = cleanString(body.button_text || campaign.button_text);
      const nextCategory = serializeCampaignCategories(body.category ?? campaign.category, 3);
      let nextContinents = cleanString(body.continents || campaign.continents || "[]");
      if (campaign.type !== "broadcast") {
        try {
          nextContinents = serializeExplicitCampaignAudience(body.continents);
        } catch (error) {
          return NextResponse.json({
            error: error instanceof Error ? error.message : "Target audience is invalid",
          }, { status: 400 });
        }
      }
      const imageFile = formData?.get("image") instanceof File ? formData.get("image") as File : null;
      const uploadedImageUrl = await uploadCampaignImage(imageFile);
      const nextImageUrl = uploadedImageUrl || cleanString(body.image_url || campaign.image_url || "");
      const targeting = normalizeAdvertiserTargeting({
        countries: body.countries ?? campaign.countries,
        languages: body.languages ?? campaign.languages,
        vpn_policy: body.vpn_policy ?? campaign.vpn_policy,
        device_policy: body.device_policy ?? campaign.device_policy,
        os_policy: body.os_policy ?? campaign.os_policy,
        start_at: body.start_at ?? campaign.start_at,
        end_at: body.end_at ?? campaign.end_at,
        daily_budget_limit: body.daily_budget_limit ?? campaign.daily_budget_limit,
        frequency_cap_per_user: body.frequency_cap_per_user ?? campaign.frequency_cap_per_user,
      }, Number(campaign.total_budget || campaign.budget || 0));
      if (campaign.campaign_kind === "channel_growth") {
        try {
          validateGrowthBudgets(Number(campaign.total_budget || campaign.budget || 0), targeting.daily_budget_limit);
          validateGrowthMessageText(nextMessage);
        } catch (error) {
          return NextResponse.json({ error: error instanceof Error ? error.message : "Channel Growth campaign is invalid." }, { status: 400 });
        }
      }

      if (nextName.length < 3 || nextName.length > 50) {
        return NextResponse.json({ error: "Campaign name must be 3-50 characters" }, { status: 400 });
      }
      if (nextTitle.length < 3 || nextTitle.length > 255) {
        return NextResponse.json({ error: "Campaign title must be 3-255 characters" }, { status: 400 });
      }
      if (!nextMessage.trim() || nextMessage.length > 1000) {
        return NextResponse.json({ error: "Message text must be 1-1000 characters" }, { status: 400 });
      }
      if (!nextButtonText || nextButtonText.length > 64) {
        return NextResponse.json({ error: "Button text is required" }, { status: 400 });
      }
      try {
        const parsed = new URL(nextLink);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("invalid_protocol");
      } catch {
        return NextResponse.json({ error: "Promotion URL must be a valid HTTP or HTTPS URL" }, { status: 400 });
      }
      if (campaign.type === "clicks" && (hasRestrictedClickCreativeContent(nextTitle) || hasRestrictedClickCreativeContent(nextMessage))) {
        return NextResponse.json({
          error: "Click campaigns cannot contain usernames (@) or links in the campaign title or message text. Use the button for your link.",
        }, { status: 400 });
      }

      const sensitiveChanged = [
        String(campaign.campaign_title || "") !== nextTitle,
        String(campaign.message_text || "") !== nextMessage,
        String(campaign.image_url || "") !== nextImageUrl,
        String(campaign.link || "") !== nextLink,
        String(campaign.button_text || "") !== nextButtonText,
      ].some(Boolean);
      const requestedTeaserMode=String(body.teaser_mode||campaign.teaser_mode||"none");
      if(requestedTeaserMode==="standard_plus_teaser"&&String(campaign.teaser_mode||"none")!=="standard_plus_teaser")return NextResponse.json({error:"Teaser Ads must be created as a separate campaign."},{status:400});
      let teaserVariants:string[]|null=null,teaserCta:string|null=null,teaserCpm:number|null=null;if(requestedTeaserMode!=="none"){if(campaign.type==="clicks")return NextResponse.json({error:"Teaser is available for Views campaigns only."},{status:400});try{teaserVariants=normalizeTeaserVariants(JSON.parse(String(body.teaser_variants||"[]")));teaserCta=validateTeaserCta(body.teaser_cta||campaign.teaser_cta_key);const [settingRows]=await pool.query<Array<RowDataPacket&{key:string;value:string}>>("SELECT `key`,value FROM settings WHERE `key` IN ('teaser_min_cpm','teaser_max_cpm')");const m=new Map(settingRows.map(row=>[row.key,Number(row.value)]));teaserCpm=validateTeaserCpm(body.teaser_cpm||campaign.teaser_cpm,{min:m.get("teaser_min_cpm")??.5,max:m.get("teaser_max_cpm")??6.5});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Invalid Teaser settings"},{status:400});}}

      const updates = [
        "name = ?",
        "campaign_title = ?",
        "message_text = ?",
        "image_url = ?",
        "link = ?",
        "button_text = ?",
        "category = ?",
        "continents = ?",
        "countries = ?",
        "languages = ?",
        "vpn_policy = ?",
        "device_policy = ?",
        "os_policy = ?",
        "start_at = ?",
        "end_at = ?",
        "daily_budget_limit = ?",
        "frequency_cap_per_user = ?",
        "updated_at = NOW()",
      ];
      const values: unknown[] = [
        nextName,
        nextTitle,
        nextMessage,
        nextImageUrl || null,
        nextLink,
        nextButtonText,
        nextCategory,
        nextContinents,
        ...targetingDbParams(targeting),
      ];

      if (sensitiveChanged) {
        updates.push("status = 'pending'", "rejection_reason = NULL");
      }

      values.push(id, user.id);
      await pool.query(`UPDATE campaigns SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`, values);
      if(teaserVariants){
        // Preserve existing creative IDs for positions that remain in use.
        for(const [position,copy] of teaserVariants.entries()){
          await pool.query(
            "INSERT INTO teaser_creatives(campaign_id,copy_text,position,active) VALUES(?,?,?,1) ON DUPLICATE KEY UPDATE copy_text=VALUES(copy_text),active=1",
            [id,copy,position+1]
          );
        }

        // Only deactivate positions removed from the campaign.
        await pool.query(
          "UPDATE teaser_creatives SET active=0 WHERE campaign_id=? AND position>?",
          [id,teaserVariants.length]
        );

        // Keep legacy compatibility message synchronized to Teaser Message 1.
        await pool.query(
          "UPDATE campaigns SET teaser_enabled=1,teaser_mode=?,teaser_cta_key=?,teaser_cpm=?,message_text=? WHERE id=? AND user_id=?",
          [
            String(body.teaser_mode||campaign.teaser_mode),
            teaserCta,
            teaserCpm,
            teaserVariants[0],
            id,
            user.id
          ]
        );
      }
      await replaceCampaignExclusions(pool, {
        campaignType: "campaign",
        campaignId: Number(id),
        inventoryType: campaign.type === "broadcast" ? "bot" : "channel",
        identifiers: body.excluded_inventory,
      });

      if (sensitiveChanged) {
        await safeNotify(campaign.telegram_id, `Your campaign "${nextName}" was updated and sent for review. Delivery will resume after approval.`);
      }

      return campaignMutationSuccess(Number(user.id), { success: true, resubmitted: sensitiveChanged, status: sensitiveChanged ? "pending" : campaign.status });
    }

    if (action === "toggle") {
      if (campaign.status === "pending") {
        return NextResponse.json({ error: "Cannot toggle pending campaigns" }, { status: 400 });
      }

      const campaignKind = pausableCampaignKind(campaign.type);
      if (!campaignKind) {
        return NextResponse.json({ error: "This campaign type cannot be paused or resumed" }, { status: 400 });
      }

      if (campaign.status === "active") {
        await assertCampaignLifecycleColumns();
        if (campaignKind === "bot") {
          await pool.query(`
            UPDATE campaigns
            SET status = 'paused',
              paused_at = NOW(),
              resume_locked_until = NULL,
              pause_reason = 'user_paused'
            WHERE id = ? AND user_id = ?
          `, [id, user.id]);
          return campaignMutationSuccess(Number(user.id), { success: true, status: "paused" });
        }

        const [pauseResult] = await pool.query<ResultSetHeader>(`
          UPDATE campaigns
          SET status = 'paused',
            paused_at = NOW(),
            resume_locked_until = DATE_ADD(NOW(), INTERVAL 1 HOUR),
            pause_reason = 'user_paused',
            channel_settlement_finalized_at = NULL
          WHERE id = ? AND user_id = ? AND status = 'active'
        `, [id, user.id]);
        if (pauseResult.affectedRows !== 1) {
          return NextResponse.json({ error: "Campaign status changed. Please refresh and try again." }, { status: 409 });
        }
        if (campaign.campaign_kind === "channel_growth") {
          await pool.query(
            "UPDATE channel_growth_invites SET status='revoke_pending' WHERE campaign_id=? AND status='active'",
            [id]
          );
          try {
            await deleteActiveCampaignPosts(id);
          } catch (error) {
            console.error("Channel Growth pause cleanup failed", { campaignId: id, error: error instanceof Error ? error.message : "unknown_error" });
          }
        }
        if(campaign.teaser_enabled)await pool.query("UPDATE teaser_placements SET status='removal_pending',removal_requested_at=COALESCE(removal_requested_at,NOW()),removal_reason='campaign_paused' WHERE campaign_id=? AND status IN ('active','awaiting_baseline')",[id]);
        return campaignMutationSuccess(Number(user.id), { success: true, status: "paused", cleanup_queued: true });
      }

      if (campaign.status === "paused") {
        await assertCampaignLifecycleColumns();

        if (campaignKind === "channel" && campaign.pause_reason === "user_paused" && campaign.resume_locked_until) {
          const lockedUntil = new Date(campaign.resume_locked_until);
          if (lockedUntil.getTime() > Date.now()) {
            return NextResponse.json({
              error: "This campaign cannot be resumed until the 1-hour pause period has ended."
            }, { status: 400 });
          }
        }

        const discount = await getAdvertiserDiscount(pool, user.id);
        const isGrowthCampaign = campaign.campaign_kind === "channel_growth";
        const isClickCampaign = campaign.type === "clicks";
        const grossRate = isClickCampaign ? campaign.cpc : campaign.cpm;
        const unitPrice = isGrowthCampaign
          ? String(campaign.cost_per_subscriber)
          : String(effectiveBidPerThousand(grossRate, isClickCampaign ? discount.cpc_discount : discount.cpm_discount) / 1000);
        const [affordability] = await pool.query<RowDataPacket[]>(
          `SELECT EXISTS(
             SELECT 1 FROM campaigns c JOIN users u ON u.id=c.user_id
             WHERE c.id=? AND c.user_id=? AND CAST(? AS DECIMAL(20,8))>0
               AND c.budget>=CAST(? AS DECIMAL(20,8))
               AND u.ad_balance>=CAST(? AS DECIMAL(20,8))
           ) affordable`,
          [id, user.id, unitPrice, unitPrice, unitPrice],
        );
        if (Number(affordability[0]?.affordable || 0) !== 1) {
          return NextResponse.json({
            error: "Campaign allowance and ad balance must cover the next billable event before resuming.",
          }, { status: 400 });
        }

        await pool.query(`
          UPDATE campaigns
          SET status = 'active',
            pause_reason = NULL,
            paused_at = NULL,
            resume_locked_until = NULL
          WHERE id = ? AND user_id = ?
        `, [id, user.id]);

        return campaignMutationSuccess(Number(user.id), { success: true, status: "active" });
      }

      return NextResponse.json({ error: "This campaign status cannot be toggled" }, { status: 400 });
    }

    if(action==="disable_teaser"){
      if(campaign.type!=="views"||campaign.teaser_mode!=="standard_plus_teaser")return NextResponse.json({error:"TEASER_DISABLE_NOT_AVAILABLE"},{status:400});
      if(!campaign.teaser_enabled)return campaignMutationSuccess(Number(user.id),{success:true,teaser_enabled:false,idempotent:true,standard_campaign_status:campaign.status});
      await pool.query("UPDATE campaigns SET teaser_enabled=0,teaser_paused_at=NOW(),teaser_resume_locked_until=DATE_ADD(NOW(),INTERVAL 1 HOUR) WHERE id=? AND user_id=? AND teaser_enabled=1",[id,user.id]);
      await pool.query("UPDATE teaser_placements SET status='removal_pending',removal_requested_at=COALESCE(removal_requested_at,NOW()),removal_reason='teaser_disabled' WHERE campaign_id=? AND status IN ('active','awaiting_baseline')",[id]);
      return campaignMutationSuccess(Number(user.id),{success:true,teaser_enabled:false,cleanup_queued:true,standard_campaign_status:campaign.status});
    }

    if(action==="toggle_teaser"||action==="enable_teaser"){
      if(campaign.type!=="views"||campaign.teaser_mode==="none")return NextResponse.json({error:"TEASER_NOT_AVAILABLE"},{status:400});
      // The explicit resume action is intentionally body-free so a retry cannot
      // accidentally turn into a disable request if its JSON body is stripped.
      const enable=action==="enable_teaser"||body.enabled===true||body.enabled===1||body.enabled==="1"||body.enabled==="true";
      if(!enable)return NextResponse.json({error:"USE_DISABLE_TEASER_ACTION"},{status:400});
      if(campaign.teaser_enabled)return campaignMutationSuccess(Number(user.id),{success:true,teaser_enabled:true,idempotent:true});
      if(campaign.teaser_resume_locked_until&&new Date(campaign.teaser_resume_locked_until).getTime()>Date.now())return NextResponse.json({error:"TEASER_RESUME_COOLDOWN",resume_locked_until:campaign.teaser_resume_locked_until},{status:409});
      try {
        validateTeaserCta(campaign.teaser_cta_key);
        const [settingRows]=await pool.query<Array<RowDataPacket&{key:string;value:string}>>("SELECT `key`,value FROM settings WHERE `key` IN ('teaser_min_cpm','teaser_max_cpm')");
        const settings=new Map(settingRows.map(row=>[row.key,Number(row.value)]));
        validateTeaserCpm(campaign.teaser_cpm,{min:settings.get("teaser_min_cpm")??.5,max:settings.get("teaser_max_cpm")??6.5});
      } catch {
        return NextResponse.json({error:"TEASER_RESUME_NOT_ELIGIBLE"},{status:409});
      }
      const [eligibility]=await pool.query<RowDataPacket[]>(`SELECT EXISTS(SELECT 1 FROM campaigns c JOIN users u ON u.id=c.user_id WHERE c.id=? AND c.user_id=? AND c.status='active' AND c.budget>=ROUND(c.teaser_cpm/1000,8) AND u.ad_balance>=ROUND(c.teaser_cpm/1000,8) AND c.teaser_cpm>0 AND (SELECT COUNT(*) FROM teaser_creatives tc WHERE tc.campaign_id=c.id AND tc.active=1 AND CHAR_LENGTH(tc.copy_text) BETWEEN 20 AND 80) BETWEEN 2 AND 5) eligible`,[id,user.id]);
      if(Number(eligibility[0]?.eligible||0)!==1)return NextResponse.json({error:"TEASER_RESUME_NOT_ELIGIBLE"},{status:409});
      await pool.query("UPDATE campaigns SET teaser_enabled=1,teaser_paused_at=NULL,teaser_resume_locked_until=NULL WHERE id=? AND user_id=? AND teaser_enabled=0",[id,user.id]);
      return campaignMutationSuccess(Number(user.id),{success:true,teaser_enabled:true});
    }

    if (action === "add_fund") {
      const amount = parseFloat(body.amount);
      if (isNaN(amount) || amount <= 0) {
        return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
      }

      // Schema readiness is invariant metadata; never inspect it while holding
      // financial row locks.
      if (campaign.status === "budget_exhausted") await assertCampaignLifecycleColumns();

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        const [lockedCampaigns] = await conn.query<Array<RowDataPacket & {
          id: number; name: string; status: string; auto_reactivate: number | boolean;
        }>>(
          "SELECT id, name, status, auto_reactivate FROM campaigns WHERE id = ? AND user_id = ? FOR UPDATE",
          [id, user.id]
        );
        const lockedCampaign = lockedCampaigns[0];
        if (!lockedCampaign) {
          await conn.rollback();
          return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
        }

        // A direct-debit campaign budget is a cap, not a funded sub-wallet.
        // Increasing it never moves advertiser money.
        if (lockedCampaign.status === "budget_exhausted") {
          const shouldAutoReactivate = lockedCampaign.auto_reactivate === 1 || lockedCampaign.auto_reactivate === true;

          if (shouldAutoReactivate) {
            await conn.query(`
              UPDATE campaigns
              SET budget = budget + ?, total_budget = total_budget + ?,
                status = 'active',
                budget_exhausted_at = NULL,
                pause_reason = NULL,
                completed_at = NULL
              WHERE id = ?
            `, [amount, amount, id]);
          } else {
            // New budget is available again, but do not silently resume delivery.
            // Move the campaign into a resumable paused state.
            await conn.query(`
              UPDATE campaigns
              SET budget = budget + ?,
                  total_budget = total_budget + ?,
                  status = 'paused',
                  budget_exhausted_at = NULL,
                  pause_reason = 'advertiser_paused',
                  completed_at = NULL
              WHERE id = ?
            `, [amount, amount, id]);
          }
        } else {
          await conn.query(
            "UPDATE campaigns SET budget = budget + ?, total_budget = total_budget + ? WHERE id = ?",
            [amount, amount, id]
          );
        }

        await conn.commit();
        return campaignMutationSuccess(Number(user.id), { success: true });
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    }

    if (action === "set_budget_cap") {
      const requestedCap = cleanString(body.amount ?? body.total_budget);
      if (!/^\d+(?:\.\d{1,8})?$/.test(requestedCap) || !/[1-9]/.test(requestedCap)) {
        return NextResponse.json({ error: "Invalid campaign budget cap" }, { status: 400 });
      }
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [locked] = await conn.query<Array<RowDataPacket & {
          campaign_kind: string;
          status: string;
          auto_reactivate: number | boolean;
          budget: string | number;
          total_budget: string | number;
        }>>(
          "SELECT id,campaign_kind,status,auto_reactivate,budget,total_budget FROM campaigns WHERE id=? AND user_id=? FOR UPDATE",
          [id, user.id],
        );
        if (!locked.length) {
          await conn.rollback();
          return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
        }
        if (locked[0].campaign_kind === "channel_growth" && Number(requestedCap) < GROWTH_MIN_TOTAL_BUDGET) {
          await conn.rollback();
          return NextResponse.json({ error: `Channel Growth total budget must be at least $${GROWTH_MIN_TOTAL_BUDGET}.` }, { status: 400 });
        }
        const [updated] = await conn.query<ResultSetHeader>(
          `UPDATE campaigns
           SET budget=budget-(total_budget-CAST(? AS DECIMAL(20,8))),
               total_budget=CAST(? AS DECIMAL(20,8)),updated_at=NOW()
           WHERE id=? AND user_id=?
             AND CAST(? AS DECIMAL(20,8))>=total_budget-budget
             AND budget>=(total_budget-CAST(? AS DECIMAL(20,8)))`,
          [requestedCap, requestedCap, id, user.id, requestedCap, requestedCap],
        );
        if (updated.affectedRows !== 1) {
          await conn.rollback();
          return NextResponse.json({
            error: "Budget cap cannot be lower than actual spend or currently committed allowance.",
          }, { status: 409 });
        }

        if (locked[0].status === "budget_exhausted") {
          const previousTotal = Number(locked[0].total_budget || 0);
          const previousRemaining = Number(locked[0].budget || 0);
          const actualSpent = Math.max(0, previousTotal - previousRemaining);
          const newRemaining = Number(requestedCap) - actualSpent;

          if (newRemaining > 0.00000001) {
            const shouldAutoReactivate =
              locked[0].auto_reactivate === 1 ||
              locked[0].auto_reactivate === true;

            await conn.query(`
              UPDATE campaigns
              SET status = ?,
                  budget_exhausted_at = NULL,
                  pause_reason = ?,
                  completed_at = NULL
              WHERE id = ? AND user_id = ?
            `, [
              shouldAutoReactivate ? "active" : "paused",
              shouldAutoReactivate ? null : "advertiser_paused",
              id,
              user.id,
            ]);
          }
        }

        await conn.commit();
        return campaignMutationSuccess(Number(user.id), { success: true });
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: getAuthErrorStatus(error) });
  }
}
