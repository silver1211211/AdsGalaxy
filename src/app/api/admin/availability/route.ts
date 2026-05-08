import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { checkAdminAuth } from "@/lib/adminAuth";

export async function GET(request: Request) {
  if (!(await checkAdminAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "broadcast"; // broadcast or clicks/views
  const category = searchParams.get("category") || "";
  const continent = searchParams.get("continent") || "";

  try {
    if (type === "broadcast") {
      const [bots]: any = await pool.query("SELECT id, categories, continents FROM bots WHERE status = 'active' AND is_deleted = FALSE");
      
      const filteredBots = bots.filter((bot: any) => {
        let catMatch = true;
        let contMatch = true;

        if (category) {
          const botCats = bot.categories ? (typeof bot.categories === 'string' ? JSON.parse(bot.categories) : bot.categories) : [];
          catMatch = botCats.includes(category);
        }

        if (continent) {
          const botConts = bot.continents ? (typeof bot.continents === 'string' ? JSON.parse(bot.continents) : bot.continents) : [];
          contMatch = botConts.includes(continent) || botConts.includes("Global");
        }

        return catMatch && contMatch;
      });

      const botIds = filteredBots.map((b: any) => b.id);
      let totalUsers = 0;
      if (botIds.length > 0) {
        const [userCount]: any = await pool.query("SELECT COUNT(*) as count FROM bot_users WHERE bot_id IN (?) AND is_active = TRUE", [botIds]);
        totalUsers = userCount[0].count;
      }

      return NextResponse.json({
        type: "broadcast",
        itemCount: filteredBots.length,
        userCount: totalUsers,
      });
    } else {
      // clicks/views (Channels)
      const [channels]: any = await pool.query("SELECT id, categories, audience_continents, subscriber_count FROM channels WHERE status = 'active' AND is_deleted = FALSE");

      const filteredChannels = channels.filter((ch: any) => {
        let catMatch = true;
        let contMatch = true;

        if (category) {
          const chCats = ch.categories ? (typeof ch.categories === 'string' ? JSON.parse(ch.categories) : ch.categories) : [];
          catMatch = chCats.includes(category);
        }

        if (continent) {
          const chConts = ch.audience_continents ? (typeof ch.audience_continents === 'string' ? JSON.parse(ch.audience_continents) : ch.audience_continents) : [];
          contMatch = chConts.includes(continent) || chConts.includes("Global");
        }

        return catMatch && contMatch;
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
