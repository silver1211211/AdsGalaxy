import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);

    const [campaignRows]: any = await pool.query(
      "SELECT * FROM campaigns WHERE id = ? AND user_id = ?",
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
        "SELECT COUNT(*) as count, SUM(cost) as total_cost FROM broadcast_deliveries WHERE campaign_id = ?",
        [id]
      );
      
      // Get stats by bot
      const [botStats]: any = await pool.query(
        `SELECT b.bot_name, b.bot_username, 
         COUNT(*) as delivery_count, 
         SUM(bd.cost) as total_spent
         FROM broadcast_deliveries bd
         JOIN bots b ON bd.bot_id = b.id
         WHERE bd.campaign_id = ?
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
        `SELECT cp.*, ch.title as channel_title, ch.username as channel_username,
         (SELECT COUNT(*) FROM campaign_clicks cc WHERE cc.post_id = cp.id) as post_clicks,
         (SELECT COUNT(*) FROM campaign_views_audit cva WHERE cva.post_id = cp.id AND cva.status = 'invalid') as invalid_audit_count,
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
    return NextResponse.json({ error: error.message }, { status: 500 });
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
      "SELECT * FROM campaigns WHERE id = ? AND user_id = ?",
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

      const newStatus = campaign.status === "active" ? "paused" : "active";
      await pool.query("UPDATE campaigns SET status = ? WHERE id = ?", [newStatus, id]);
      return NextResponse.json({ success: true, status: newStatus });
    }

    if (action === "add_fund") {
      const amount = parseFloat(body.amount);
      if (isNaN(amount) || amount <= 0) {
        return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
      }

      // Check balance
      const [userRows]: any = await pool.query("SELECT ad_balance FROM users WHERE id = ?", [user.id]);
      const currentBalance = parseFloat(userRows[0].ad_balance || "0");
      if (currentBalance < amount) {
        return NextResponse.json({ error: "Insufficient ad balance" }, { status: 400 });
      }

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        
        // 1. Deduct from balance
        await conn.query(
          "UPDATE users SET ad_balance = ad_balance - ? WHERE id = ?",
          [amount, user.id]
        );

        // 2. Update campaign budget
        await conn.query(
          "UPDATE campaigns SET budget = budget + ? WHERE id = ?",
          [amount, id]
        );

        // 3. Log transaction
        await conn.query(
          "INSERT INTO advertiser_transactions (user_id, amount, type, description) VALUES (?, ?, 'debit', ?)",
          [user.id, amount, `Added funds to campaign: ${campaign.name}`]
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
