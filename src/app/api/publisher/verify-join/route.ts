import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { processVerifiedReferralForUser } from "@/lib/referralSprint";

export async function POST(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (user.join_rewarded) {
      return NextResponse.json({ error: "Already rewarded" }, { status: 400 });
    }

    const [[referralChannelSetting]]: any = await pool.query(
      "SELECT value FROM referral_growth_settings WHERE `key` = 'required_channel_username' LIMIT 1"
    );
    const channelUsername = String(referralChannelSetting?.value || process.env.TELEGRAM_NEWS_CHANNEL || process.env.NEXT_PUBLIC_CHANNEL || "AdsGalaxy_News")
      .replace(/^https?:\/\/t\.me\//i, "")
      .replace(/^@/, "")
      .replace(/\/$/, "");
    const rewardAmount = parseFloat(process.env.NEXT_PUBLIC_CHANNEL_REWARD || "0.5");
    const botToken = process.env.BOT_TOKEN;

    if (!channelUsername || !botToken) {
      return NextResponse.json({ error: "Configuration error" }, { status: 500 });
    }

    // Call Telegram Bot API to check membership
    const tgApiUrl = `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=@${channelUsername}&user_id=${user.telegram_id}`;
    const tgRes = await fetch(tgApiUrl);
    const tgData = await tgRes.json();

    if (!tgData.ok) {
      console.error("Telegram API Error:", tgData.description);
      return NextResponse.json({ error: "Could not verify membership" }, { status: 400 });
    }

    const status = tgData.result.status;
    const allowedStatuses = ["member", "administrator", "creator"];
    
    if (!allowedStatuses.includes(status)) {
      return NextResponse.json({ error: "You have not joined the channel yet." }, { status: 400 });
    }

    // Success! Update user
    await pool.query(
      "UPDATE users SET join_rewarded = TRUE, balance_available = balance_available + ? WHERE id = ?",
      [rewardAmount, user.id]
    );
    const referralReward = await processVerifiedReferralForUser(Number(user.id));

    return NextResponse.json({ success: true, reward: rewardAmount, referral_reward: referralReward });

  } catch (error: any) {
    console.error("Verify Join Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: getAuthErrorStatus(error) });
  }
}
