import { NextResponse } from "next/server";
/* eslint-disable @typescript-eslint/no-explicit-any -- settings and transactional rows are dynamically shaped */
import pool from "@/lib/db";
import { getAuthenticatedUser, getAuthErrorStatus } from "@/lib/auth";
import { processVerifiedReferralForUser } from "@/lib/referralSprint";
import { blockReferralForUserIfSelfDevice, getReferralSecuritySignals } from "@/lib/referralSecurity";
import { withFinancialTransactionRetry } from "@/lib/dbResilience";

export async function POST(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUser(initData, { request });
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    const tgRes = await fetch(tgApiUrl, { signal: AbortSignal.timeout(8_000) });
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

    const selfDevice = await blockReferralForUserIfSelfDevice(Number(user.id), getReferralSecuritySignals(request));
    if (selfDevice.blocked) {
      return NextResponse.json(
        { error: "Referral reward blocked: same IP address or device as the referrer.", referral_reward: selfDevice },
        { status: 400 }
      );
    }

    const rewardResult = await withFinancialTransactionRetry(async (connection) => {
      const [[lockedUser]]: any = await connection.query(
        "SELECT join_rewarded FROM users WHERE id = ? FOR UPDATE", [user.id]
      );
      if (!lockedUser) throw new Error("join_reward_user_missing");
      if (Boolean(lockedUser.join_rewarded)) return { credited: false, idempotent: true };
      const idempotencyKey = `join_channel_reward:${user.id}`;
      const [ledger]: any = await connection.query(
        `INSERT IGNORE INTO referral_reward_ledger
          (user_id, source_type, source_id, reward_type, amount, status,
           eligible_at, settled_amount, settled_at, idempotency_key, reason, metadata)
         VALUES (?, 'publisher_join_channel', ?, 'publisher_join_channel', ?, 'paid',
           NOW(), ?, NOW(), ?, 'verified_required_channel_membership', ?)`,
        [user.id, user.id, rewardAmount, rewardAmount, idempotencyKey,
          JSON.stringify({ channel_username: channelUsername })]
      );
      if (ledger.affectedRows !== 1) {
        await connection.query("UPDATE users SET join_rewarded = TRUE WHERE id = ?", [user.id]);
        return { credited: false, idempotent: true };
      }
      const [credited]: any = await connection.query(
        `UPDATE users SET join_rewarded = TRUE, balance_available = balance_available + ?
         WHERE id = ? AND join_rewarded = FALSE`, [rewardAmount, user.id]
      );
      if (credited.affectedRows !== 1) throw new Error("join_reward_credit_race");
      return { credited: true, idempotent: false };
    }, { operation: "publisher_join_reward" });
    const referralReward = rewardResult.credited
      ? await processVerifiedReferralForUser(Number(user.id))
      : { processed: false, reason: "join_reward_already_recorded" };

    return NextResponse.json({ success: true, reward: rewardResult.credited ? rewardAmount : 0,
      idempotent: rewardResult.idempotent, referral_reward: referralReward });

  } catch (error: any) {
    console.error("Verify Join Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: getAuthErrorStatus(error) });
  }
}
