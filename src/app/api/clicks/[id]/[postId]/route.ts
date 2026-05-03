import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import crypto from "crypto";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; postId: string }> }
) {
  const { id: campaignId, postId } = await params;
  
  // 1. Validate both IDs are present
  if (!campaignId || !postId) {
    // If anything is missing, we still redirect for UX, but do NOT save
    return redirectToFallback(req);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(',')[0] || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";
  
  const fingerprint = crypto
    .createHash("md5")
    .update(`${ip}-${userAgent}`)
    .digest("hex");

  try {
    // 2. Verify campaign exists AND the post belongs to this campaign
    const [rows]: any = await pool.query(
      `SELECT c.link, cp.id as post_id 
       FROM campaigns c 
       JOIN campaign_posts cp ON cp.campaign_id = c.id
       WHERE c.id = ? AND cp.id = ?`,
      [campaignId, postId]
    );

    if (rows.length === 0) {
      // If no match found, redirect to a safe fallback or original link if possible
      // But don't record the click
      const [campOnly]: any = await pool.query("SELECT link FROM campaigns WHERE id = ?", [campaignId]);
      if (campOnly.length > 0) {
        return NextResponse.redirect(campOnly[0].link, 302);
      }
      return NextResponse.redirect(process.env.NEXT_PUBLIC_APP_URL || "/", 302);
    }

    const targetUrl = rows[0].link;

    // 3. Save click in background
    (async () => {
      try {
        const isBot = /bot|spider|crawl|slurp|github-camo|googlebot|bingbot|yandex|baidu/i.test(userAgent);
        
        // Deduplication (Post + Fingerprint)
        const [existing]: any = await pool.query(
          "SELECT id FROM campaign_clicks WHERE post_id = ? AND fingerprint = ? AND created_at > NOW() - INTERVAL 1 DAY",
          [postId, fingerprint]
        );

        if (existing.length === 0 && !isBot) {
          await pool.query(
            "INSERT INTO campaign_clicks (campaign_id, post_id, ip_address, user_agent, fingerprint, is_bot) VALUES (?, ?, ?, ?, ?, ?)",
            [campaignId, postId, ip, userAgent, fingerprint, isBot]
          );
        }
      } catch (err) {
        console.error("Click Processing Background Error:", err);
      }
    })();

    return NextResponse.redirect(targetUrl, 302);
  } catch (error) {
    console.error("Click Tracking Error:", error);
    return NextResponse.redirect(process.env.NEXT_PUBLIC_APP_URL || "/", 302);
  }
}

function redirectToFallback(req: NextRequest) {
  // Safe fallback if IDs missing
  return NextResponse.redirect(process.env.NEXT_PUBLIC_APP_URL || "/", 302);
}
