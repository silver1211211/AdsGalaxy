import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { assertCampaignLifecycleColumns } from "@/lib/campaignLifecycle";
import { deleteActiveCampaignPosts } from "@/lib/campaignPostDeletion";
import { settleCampaignEngagementBeforeDeletion } from "@/lib/channelSettlement";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    const [campaignRows]: any = await pool.query(
      `SELECT id, name, campaign_title, parse_mode, message_text, image_url, link, postback_url, button_text,
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
      `SELECT DATE(created_at) as date, COUNT(*) as count 
       FROM ${chartTable}
       WHERE campaign_id = ? AND created_at > NOW() - INTERVAL 7 DAY
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
    const body = await request.json();
    const { action } = body;

    const [campaignRows]: any = await pool.query(
      `SELECT id, name, status, budget, cpm, pause_reason, resume_locked_until, auto_reactivate
       FROM campaigns WHERE id = ? AND user_id = ?`,
      [id, user.id]
    );

    if (campaignRows.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const campaign = campaignRows[0];

    if (action === "toggle") {
      if (campaign.status === "pending") {
        return NextResponse.json({ error: "Cannot toggle pending campaigns" }, { status: 400 });
      }

      if (campaign.status === "active") {
        await assertCampaignLifecycleColumns();
        if (!process.env.BOT_TOKEN) {
          return NextResponse.json({ error: "BOT_TOKEN is missing; cannot delete active posts safely" }, { status: 500 });
        }

        // Settle any already-delivered but not-yet-billed views/clicks for this
        // campaign's channel posts before they're deleted, so the publisher isn't
        // left unpaid for engagement the advertiser already received. Must run
        // while status is still 'active' (the settlement engine only considers
        // active campaigns). No-ops safely for broadcast (bot) campaigns.
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

        const deletion = await deleteActiveCampaignPosts(id);
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
