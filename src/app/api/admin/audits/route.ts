import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";
import { sendTelegramMessage } from "@/lib/telegram";

export async function GET(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "10");
  const postIdFilter = searchParams.get("post_id");
  const offset = (page - 1) * limit;

  try {
    let postQuery = `
      SELECT audit.post_id, MAX(audit.check_time) as max_time 
      FROM campaign_views_audit audit
      JOIN campaign_posts p ON audit.post_id = p.id
      JOIN campaigns c ON p.campaign_id = c.id
      WHERE c.type != 'broadcast'
    `;
    let countQuery = `
      SELECT COUNT(DISTINCT audit.post_id) as total 
      FROM campaign_views_audit audit
      JOIN campaign_posts p ON audit.post_id = p.id
      JOIN campaigns c ON p.campaign_id = c.id
      WHERE c.type != 'broadcast'
    `;
    const params: any[] = [];

    if (postIdFilter && !isNaN(parseInt(postIdFilter))) {
      postQuery += " AND audit.post_id = ?";
      countQuery += " AND audit.post_id = ?";
      params.push(parseInt(postIdFilter));
    }

    postQuery += " GROUP BY audit.post_id ORDER BY max_time DESC LIMIT ? OFFSET ?";
    
    const [postRows]: any = await pool.query(postQuery, [...params, limit, offset]);
    const [[countRow]]: any = await pool.query(countQuery, params);

    if (postRows.length === 0) {
      return NextResponse.json({ audits: [], totalPages: 0, page });
    }

    const postIds = postRows.map((r: any) => r.post_id);

    const [auditRows]: any = await pool.query(
      "SELECT * FROM campaign_views_audit WHERE post_id IN (?) ORDER BY check_time DESC", 
      [postIds]
    );

    const [details]: any = await pool.query(`
      SELECT p.id as post_id, p.status as post_status, c.name as campaign_name, ch.title as channel_title, c.type as campaign_type,
      (SELECT SUM(advertiser_paid) FROM ad_settlements_views WHERE post_id = p.id AND status = 'locked') as total_adv_paid,
      (SELECT SUM(publisher_reward) FROM ad_settlements_views WHERE post_id = p.id AND status = 'locked') as total_pub_reward,
      (SELECT COUNT(*) FROM ad_settlements_views WHERE post_id = p.id AND status = 'unlocked') as unlocked_count,
      (SELECT COUNT(*) FROM ad_settlements_views WHERE post_id = p.id) as settlement_count
      FROM campaign_posts p
      LEFT JOIN campaigns c ON p.campaign_id = c.id
      LEFT JOIN channels ch ON p.channel_id = ch.id
      WHERE p.id IN (?)
    `, [postIds]);

    const result = postIds.map((pid: number) => {
      const records = auditRows.filter((a: any) => a.post_id === pid);
      const meta = details.find((d: any) => d.post_id === pid) || {};
      return {
        post_id: pid,
        post_status: meta.post_status,
        campaign_name: meta.campaign_name,
        channel_title: meta.channel_title,
        campaign_type: meta.campaign_type,
        has_settlement: meta.settlement_count > 0,
        total_adv_paid: parseFloat(meta.total_adv_paid || 0),
        total_pub_reward: parseFloat(meta.total_pub_reward || 0),
        has_unlocked: meta.unlocked_count > 0,
        records
      };
    });

    return NextResponse.json({
      audits: result,
      total: countRow.total,
      page,
      totalPages: Math.ceil(countRow.total / limit),
    });
  } catch (error: any) {
    console.error("Admin Audits API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conn = await pool.getConnection();
  try {
    const { post_id } = await request.json();
    if (!post_id) return NextResponse.json({ error: "Missing post_id" }, { status: 400 });

    await conn.beginTransaction();

    const [details]: any = await conn.query(`
      SELECT p.status as post_status, c.name as campaign_name, ch.title as channel_title,
      c.id as campaign_id, c.user_id as advertiser_id, ch.user_id as publisher_id, c.type as campaign_type,
      u_adv.telegram_id as advertiser_telegram_id, u_pub.telegram_id as publisher_telegram_id
      FROM campaign_posts p
      LEFT JOIN campaigns c ON p.campaign_id = c.id
      LEFT JOIN channels ch ON p.channel_id = ch.id
      LEFT JOIN users u_adv ON c.user_id = u_adv.id
      LEFT JOIN users u_pub ON ch.user_id = u_pub.id
      WHERE p.id = ?
    `, [post_id]);

    if (!details.length) throw new Error("Post not found");
    const post = details[0];

    if (post.campaign_type === 'clicks') {
      throw new Error("Invalidating is not possible because this is views auditing and clicks do not need auditing as every click is verified instantly and filtered out automatically.");
    }

    if (post.post_status === 'active') {
      throw new Error("Post is still active. Please wait for it to complete.");
    }

    const [settlements]: any = await conn.query("SELECT * FROM ad_settlements_views WHERE post_id = ?", [post_id]);
    
    if (settlements.length === 0) {
      throw new Error("Invalidating is not possible because the campaign has not had any settlement yet. Both the publisher and advertiser are safe (no payments made or deducted).");
    }

    if (settlements.some((s: any) => s.status === 'unlocked')) {
      throw new Error("Balance already released. Cannot invalidate.");
    }

    const totalAdvPaid = settlements.reduce((acc: number, s: any) => acc + parseFloat(s.advertiser_paid), 0);
    const totalPubReward = settlements.reduce((acc: number, s: any) => acc + parseFloat(s.publisher_reward), 0);

    if (totalAdvPaid > 0) {
      await conn.query("UPDATE campaigns SET budget = budget + ? WHERE id = ?", [totalAdvPaid, post.campaign_id]);
    }
    if (totalPubReward > 0) {
      await conn.query("UPDATE users SET balance_locked = balance_locked - ? WHERE id = ?", [totalPubReward, post.publisher_id]);
    }

    // Delete settlements
    await conn.query("DELETE FROM ad_settlements_views WHERE post_id = ?", [post_id]);

    // Mark audits as invalid
    await conn.query("UPDATE campaign_views_audit SET status = 'invalid' WHERE post_id = ?", [post_id]);

    await conn.commit();

    // Send Notifications safely
    if (post.advertiser_telegram_id && totalAdvPaid > 0) {
      try {
        await sendTelegramMessage(
          post.advertiser_telegram_id, 
          `🔴 <b>Views Invalidated</b>\n\nYour campaign "<b>${post.campaign_name || 'N/A'}</b>" posted on "<b>${post.channel_title || 'N/A'}</b>" was found using fake/bot views.\n\nAfter detection, we have invalidated these views. The deducted amount (<b>$${totalAdvPaid.toFixed(2)}</b>) has been fully refunded to your campaign budget.`
        );
      } catch (e) { console.error(e); }
    }

    if (post.publisher_telegram_id && totalPubReward > 0) {
      try {
        await sendTelegramMessage(
          post.publisher_telegram_id, 
          `🔴 <b>Fake Views Detected</b>\n\nYour post on "<b>${post.channel_title || 'N/A'}</b>" for campaign "<b>${post.campaign_name || 'N/A'}</b>" was found using fake views.\n\nThe views have been invalidated and the locked reward (<b>$${totalPubReward.toFixed(2)}</b>) has been deducted from your account.\n\nThis action cannot be undone.`
        );
      } catch (e) { console.error(e); }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    await conn.rollback();
    console.error("Admin Audits Invalidate Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  } finally {
    conn.release();
  }
}
