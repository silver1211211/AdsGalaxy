import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { assertCampaignLifecycleColumns } from "@/lib/campaignLifecycle";
import { deleteActiveCampaignPosts } from "@/lib/campaignPostDeletion";
import { settleCampaignEngagementBeforeDeletion } from "@/lib/channelSettlement";
import { columnExists } from "@/lib/schemaGuards";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { normalizeCampaignCategory } from "@/lib/campaignCategories";
import { normalizeAdvertiserTargeting, targetingDbParams } from "@/lib/advertiserTargeting";
import { replaceCampaignExclusions } from "@/lib/campaignInventoryExclusions";
import { validatePostbackUrl } from "@/lib/conversionTracking";
import { hasRestrictedClickCreativeContent } from "@/lib/campaignCreative";
import { sendTelegramMessage } from "@/lib/telegram";

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

  const imgRes = await fetch(endpoint, { method: "POST", body: imgApiFormData });
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
    const user = await getAuthenticatedUser(initData);

    const [campaignKinds]: any = await pool.query(
      "SELECT type FROM campaigns WHERE id = ? AND user_id = ? LIMIT 1",
      [id, user.id]
    );
    if (campaignKinds.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    const isBotCampaign = campaignKinds[0].type === "broadcast";
    const [campaignRows]: any = await pool.query(
      isBotCampaign
        ? `SELECT id, name, campaign_title, message_text, image_url, link, button_text,
             type, budget, cpm, category, continents, status, created_at, updated_at
           FROM campaigns WHERE id = ? AND user_id = ?`
        : `SELECT id, name, campaign_title, parse_mode, message_text, image_url, link, postback_url, button_text,
             type, budget, cpm, category, continents, countries, languages, vpn_policy,
             device_policy, os_policy, start_at, end_at, daily_budget_limit,
             frequency_cap_per_user, direct_placement_mode, direct_inventory_scope,
             direct_inventory_metadata, status, paused_at, resume_locked_until,
             completed_at, budget_exhausted_at, pause_reason, auto_reactivate,
             created_at, updated_at
           FROM campaigns WHERE id = ? AND user_id = ?`,
      [id, user.id]
    );

    if (campaignRows.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const campaign = campaignRows[0];
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
        "SELECT FLOOR(COUNT(*) / 5) as count, SUM(cost) as total_cost FROM broadcast_deliveries WHERE campaign_id = ? AND status = 'sent'",
        [id]
      );
      
      // Get stats by bot
      const [botStats]: any = await pool.query(
        `SELECT b.bot_name, b.bot_username, 
         FLOOR(COUNT(*) / 5) as delivery_count,
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

      // Get posts with individual stats
      const [posts]: any = await pool.query(
        `SELECT
         cp.id,
         cp.campaign_id,
         cp.channel_id,
         cp.status,
         cp.created_at,
         cp.views,
         cp.message_id,
         ch.title as channel_title,
         NULL as channel_username,
         (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id = cp.id) as post_clicks,
         (SELECT SUM(advertiser_paid) FROM ad_settlements asett WHERE asett.post_id = cp.id) as total_paid
         FROM campaign_posts cp
         JOIN channels ch ON cp.channel_id = ch.id
         WHERE cp.campaign_id = ?
         ORDER BY cp.created_at DESC`,
        [id]
      );

      extraData = {
        total_clicks: clickCount[0].count,
        total_views: viewCount[0].count || 0,
        posts: posts
      };
    }

    // Get click/broadcast chart data (last 7 days)
    const chartTable = campaign.type === 'broadcast' ? 'broadcast_deliveries' : 'campaign_clicks';
    const [chartData]: any = await pool.query(
      `SELECT DATE(created_at) as date, FLOOR(COUNT(*) / 5) as count
       FROM ${chartTable}
       WHERE campaign_id = ? ${campaign.type === 'broadcast' ? "AND status = 'sent'" : ""} AND created_at > NOW() - INTERVAL 7 DAY
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [id]
    );

    return NextResponse.json({
      ...campaign,
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
          c.pause_reason, c.resume_locked_until, c.auto_reactivate, c.type, c.message_text, c.image_url,
          c.link, c.postback_url, c.button_text, c.category, c.continents, c.countries, c.languages,
          c.vpn_policy, c.device_policy, c.os_policy, c.start_at, c.end_at, c.daily_budget_limit,
          c.frequency_cap_per_user, u.telegram_id
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
      const nextPostbackUrl = validatePostbackUrl(body.postback_url ?? campaign.postback_url);
      const nextButtonText = cleanString(body.button_text || campaign.button_text);
      const nextCategory = normalizeCampaignCategory(body.category ?? campaign.category);
      const nextContinents = cleanString(body.continents || campaign.continents || "[]");
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

      const updates = [
        "name = ?",
        "campaign_title = ?",
        "message_text = ?",
        "image_url = ?",
        "link = ?",
        "postback_url = ?",
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
        nextPostbackUrl,
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
      await replaceCampaignExclusions(pool, {
        campaignType: "campaign",
        campaignId: Number(id),
        inventoryType: campaign.type === "broadcast" ? "bot" : "channel",
        identifiers: body.excluded_inventory,
      });

      if (sensitiveChanged) {
        await safeNotify(campaign.telegram_id, `Your campaign "${nextName}" was updated and sent for review. Delivery will resume after approval.`);
      }

      return NextResponse.json({ success: true, resubmitted: sensitiveChanged, status: sensitiveChanged ? "pending" : campaign.status });
    }

    if (action === "toggle") {
      if (campaign.status === "pending") {
        return NextResponse.json({ error: "Cannot toggle pending campaigns" }, { status: 400 });
      }

      if (campaign.status === "active") {
        await assertCampaignLifecycleColumns();
        const settlement = await settleCampaignEngagementBeforeDeletion(Number(id), "advertiser_pause");
        if (!settlement.ok) {
          return NextResponse.json({
            error: "Could not settle outstanding engagement for this campaign before pausing it. Please try again in a moment.",
            settlement,
          }, { status: 409 });
        }

        await pool.query(`
          UPDATE campaigns
          SET status = 'paused',
            paused_at = NOW(),
            resume_locked_until = DATE_ADD(NOW(), INTERVAL 1 HOUR),
            pause_reason = 'user_paused'
          WHERE id = ? AND user_id = ?
        `, [id, user.id]);

        if (await columnExists(pool, "campaigns", "channel_settlement_finalized_at")) {
          await pool.query(
            "UPDATE campaigns SET channel_settlement_finalized_at = COALESCE(channel_settlement_finalized_at, NOW()) WHERE id = ? AND user_id = ?",
            [id, user.id]
          );
        }

        let deletion: Awaited<ReturnType<typeof deleteActiveCampaignPosts>> | null = null;
        try {
          deletion = await deleteActiveCampaignPosts(id);
        } catch (cleanupError) {
          console.warn("Advertiser pause Telegram cleanup failed after settlement", {
            campaign_id: id,
            error: cleanupError instanceof Error ? cleanupError.message : "unknown_cleanup_error",
          });
        }
        return NextResponse.json({ success: true, status: "paused", deletion, settlement });
      }

      if (campaign.status === "paused") {
        await assertCampaignLifecycleColumns();

        if (campaign.pause_reason === "user_paused" && campaign.resume_locked_until) {
          const lockedUntil = new Date(campaign.resume_locked_until);
          if (lockedUntil.getTime() > Date.now()) {
            return NextResponse.json({
              error: `This campaign can be resumed after ${lockedUntil.toLocaleString()}. Admin can resume it earlier.`
            }, { status: 400 });
          }
        }

        // Resuming must not require a locked/reserved campaign budget — only that
        // the advertiser's own ad_balance can cover at least the next billable
        // unit (view/click/broadcast send) at this campaign's CPM rate. Settlement
        // itself is unchanged: if campaigns.budget is genuinely exhausted, the
        // existing settlement/broadcast exhaustion logic will still apply once
        // engagement is billed.
        if (parseFloat(campaign.budget || "0") <= 0) {
          const unitPrice = parseFloat(campaign.cpm || "0") / 1000;
          const [balanceRows] = await pool.query<RowDataPacket[]>(
            "SELECT ad_balance FROM users WHERE id = ?",
            [user.id]
          );
          const adBalance = parseFloat(String(balanceRows[0]?.ad_balance ?? "0"));
          if (!(unitPrice > 0) || adBalance < unitPrice) {
            return NextResponse.json({
              error: "Insufficient ad balance to resume this campaign. Add funds to your ad balance to cover at least the next billable impression.",
            }, { status: 400 });
          }
        }

        await pool.query(`
          UPDATE campaigns
          SET status = 'active',
            pause_reason = NULL,
            paused_at = NULL,
            resume_locked_until = NULL
          WHERE id = ? AND user_id = ?
        `, [id, user.id]);

        return NextResponse.json({ success: true, status: "active" });
      }

      return NextResponse.json({ error: "This campaign status cannot be toggled" }, { status: 400 });
    }

    if (action === "add_fund") {
      const amount = parseFloat(body.amount);
      if (isNaN(amount) || amount <= 0) {
        return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
      }

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

        const [balanceRows] = await conn.query<RowDataPacket[]>(
          "SELECT ad_balance FROM users WHERE id = ? FOR UPDATE",
          [user.id]
        );
        if (!balanceRows[0]) throw new Error("advertiser_not_found");

        const [balanceUpdate] = await conn.query<ResultSetHeader>(
          "UPDATE users SET ad_balance = ad_balance - ? WHERE id = ? AND ad_balance >= ?",
          [amount, user.id, amount]
        );
        if (balanceUpdate.affectedRows !== 1) {
          await conn.rollback();
          return NextResponse.json({ error: "Insufficient ad balance" }, { status: 400 });
        }

        // 2. Update campaign budget, with guarded auto-reactivation for exhausted campaigns
        if (lockedCampaign.status === "budget_exhausted") {
          await assertCampaignLifecycleColumns();
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
            await conn.query(
              "UPDATE campaigns SET budget = budget + ?, total_budget = total_budget + ? WHERE id = ?",
              [amount, amount, id]
            );
          }
        } else {
          await conn.query(
            "UPDATE campaigns SET budget = budget + ?, total_budget = total_budget + ? WHERE id = ?",
            [amount, amount, id]
          );
        }

        // 3. Log transaction
        await conn.query(
          "INSERT INTO advertiser_transactions (user_id, amount, type, description) VALUES (?, ?, 'debit', ?)",
          [user.id, amount, `Added funds to campaign: ${lockedCampaign.name}`]
        );

        await conn.commit();
        return NextResponse.json({ success: true });
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: getAuthErrorStatus(error) });
  }
}
