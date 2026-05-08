import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";

export async function GET(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "broadcast";
  const category = searchParams.get("category") || "";
  const continentsParam = searchParams.get("continents") || "Global";
  const predictionMinutes = parseInt(searchParams.get("predictionMinutes") || "0");
  const selectedContinents = continentsParam.split(",");

  try {
    if (type === "broadcast") {
      const [bots]: any = await pool.query("SELECT id, categories, continents, posts_per_day FROM bots WHERE status = 'active' AND is_deleted = FALSE");
      
      const filteredBots = bots.filter((bot: any) => {
        let catMatch = true;
        let contMatch = true;

        if (category) {
          const botCats = bot.categories ? (typeof bot.categories === 'string' ? JSON.parse(bot.categories) : bot.categories) : [];
          catMatch = botCats.includes(category);
        }

        if (continentsParam && !selectedContinents.includes("Global")) {
          const botConts = bot.continents ? (typeof bot.continents === 'string' ? JSON.parse(bot.continents) : bot.continents) : [];
          contMatch = botConts.includes("Global") || selectedContinents.some(c => botConts.includes(c));
        }

        return catMatch && contMatch;
      });

      const botIds = filteredBots.map((b: any) => b.id);
      let totalUsers = 0;
      if (botIds.length > 0) {
        // Use 6 hours as the gap for broadcast as per user requirement
        const hoursInterval = 6;
          
        const [userCount]: any = await pool.query(`
          SELECT COUNT(*) as count FROM bot_users bu
          WHERE bu.bot_id IN (?) AND bu.is_active = TRUE
          AND (
            bu.last_broadcast_at IS NULL 
            OR bu.last_broadcast_at < (NOW() + INTERVAL ? MINUTE) - INTERVAL ? HOUR
          )
          AND (
            SELECT COUNT(*) FROM broadcast_deliveries bd 
            WHERE bd.user_id = bu.id AND bd.created_at > (NOW() + INTERVAL ? MINUTE) - INTERVAL 1 DAY
          ) < (SELECT posts_per_day FROM bots WHERE id = bu.bot_id)
        `, [botIds, predictionMinutes, hoursInterval, predictionMinutes]);
        
        totalUsers = userCount[0].count;
      }

      return NextResponse.json({
        type: "broadcast",
        itemCount: filteredBots.length,
        userCount: totalUsers,
      });
    } else {
      const [channels]: any = await pool.query(`
        SELECT c.*, 
        (SELECT COUNT(*) FROM campaign_posts cp WHERE cp.channel_id = c.id AND cp.created_at > (NOW() + INTERVAL ? MINUTE) - INTERVAL 1 DAY) as daily_posts,
        (SELECT MAX(created_at) FROM campaign_posts cp WHERE cp.channel_id = c.id) as last_post_at
        FROM channels c
        WHERE c.status = 'active' AND c.is_deleted = FALSE
      `, [predictionMinutes]);

      const filteredChannels = channels.filter((ch: any) => {
        let catMatch = true;
        let contMatch = true;

        if (category) {
          const chCats = ch.categories ? (typeof ch.categories === 'string' ? JSON.parse(ch.categories) : ch.categories) : [];
          catMatch = chCats.includes(category);
        }

        if (continentsParam && !selectedContinents.includes("Global")) {
          const chConts = ch.audience_continents ? (typeof ch.audience_continents === 'string' ? JSON.parse(ch.audience_continents) : ch.audience_continents) : [];
          contMatch = chConts.includes("Global") || selectedContinents.some(c => chConts.includes(c));
        }

        // Channels already use 6 hours
        const isEligible = ch.daily_posts < ch.posts_per_day && (
          !ch.last_post_at || 
          new Date(ch.last_post_at).getTime() < (Date.now() + predictionMinutes * 60000) - (6 * 60 * 60 * 1000)
        );

        return catMatch && contMatch && isEligible;
      });

      const totalSubscribers = filteredChannels.reduce((acc: number, ch: any) => acc + (ch.subscriber_count || 0), 0);

      return NextResponse.json({
        type: "clicks_views",
        itemCount: filteredChannels.length,
        userCount: totalSubscribers,
      });
    }
  } catch (error: any) {
    console.error("Availability Check API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
