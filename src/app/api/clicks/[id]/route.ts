import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import crypto from "crypto";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: campaignId } = await params;
  
  // Get user info for tracking
  const ip = req.headers.get("x-forwarded-for")?.split(',')[0] || "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";
  
  // Create a device fingerprint (simplified)
  const fingerprint = crypto
    .createHash("md5")
    .update(`${ip}-${userAgent}`)
    .digest("hex");

  try {
    // 1. Get campaign link
    const [rows]: any = await pool.query(
      "SELECT link FROM campaigns WHERE id = ?",
      [campaignId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const targetUrl = rows[0].link;

    // 2. Async Tracking (Don't block the redirect)
    // We'll wrap this in a self-executing async function or just run it and not await
    (async () => {
      try {
        // Basic Bot Detection
        const isBot = /bot|spider|crawl|slurp|github-camo|googlebot|bingbot|yandex|baidu/i.test(userAgent);
        
        // Deduplication Check (Same campaign, same fingerprint in last 24h)
        const [existing]: any = await pool.query(
          "SELECT id FROM campaign_clicks WHERE campaign_id = ? AND fingerprint = ? AND created_at > NOW() - INTERVAL 1 DAY",
          [campaignId, fingerprint]
        );

        if (existing.length === 0 && !isBot) {
          // Record the click
          await pool.query(
            "INSERT INTO campaign_clicks (campaign_id, ip_address, user_agent, fingerprint, is_bot) VALUES (?, ?, ?, ?, ?)",
            [campaignId, ip, userAgent, fingerprint, isBot]
          );
          
          // Optionally deduct click cost here if needed
          // await pool.query("UPDATE campaigns SET budget = budget - click_cost WHERE id = ?", [campaignId]);
        }
      } catch (err) {
        console.error("Click Processing Background Error:", err);
      }
    })();

    // 3. Immediate Redirect
    return NextResponse.redirect(targetUrl, 302);
  } catch (error) {
    console.error("Click Tracking Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
