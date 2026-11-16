import { NextResponse } from "next/server";
/* eslint-disable @typescript-eslint/no-explicit-any -- authenticated referral summary is dynamically shaped */
import { getAuthenticatedUserStatus, getAuthErrorStatus } from "@/lib/auth";
import pool from "@/lib/db";
import { formatCommissionUsdt } from "@/lib/referralCommission";
import { getPublisherReferralLink } from "@/lib/publisherReferralLink";
import type { RowDataPacket } from "mysql2/promise";

// Keep paid legacy publisher commissions visible alongside the new 10% ledger.
// Historical fixed join rewards remain in their original ledger.
const REFERRAL_COMMISSION_ROWS = `(
  SELECT referrer_user_id,referred_user_id,product_type,monetized_earning_amount,
         commission_amount,settled_at
  FROM referral_revenue_commissions WHERE status='settled'
  UNION ALL
  SELECT referrer_user_id,referred_publisher_id AS referred_user_id,
         'channel' AS product_type,gross_publisher_amount AS monetized_earning_amount,
         amount AS commission_amount,settled_at
  FROM referral_commission_ledger WHERE status='paid'
)`;


export async function GET(request: Request) {
  try {
    const initData = request.headers.get("x-telegram-init-data");
    const user = await getAuthenticatedUserStatus(initData, { request });
    const userId = Number(user.id);

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const historyPage = Math.max(1, parseInt(searchParams.get("historyPage") || "1", 10) || 1);
    const pageSizeParam = parseInt(searchParams.get("pageSize") || "10", 10);
    const pageSize = [10, 25, 50].includes(pageSizeParam) ? pageSizeParam : 10;
    const search = String(searchParams.get("search") || "").trim().toLowerCase();
    const status = String(searchParams.get("status") || "all").toLowerCase();
    const sortBy = String(searchParams.get("sortBy") || "recent").toLowerCase();

    // Keep each publisher's existing code; the lightweight link route stays
    // available even when a separate statistics query fails.
    const { referralCode, referralLink } = await getPublisherReferralLink(userId);

    // 2. Summary stats
    // Total referrals count
    const [[referralCountRow]] = await pool.query<Array<RowDataPacket & { count: number }>>(
      "SELECT COUNT(*) AS count FROM referrals WHERE invited_by = ?",
      [userId]
    );
    const totalReferrals = Number(referralCountRow?.count || 0);

    // Paid referral history remains in the canonical ledger, including older
    // fixed rewards. The separate 0.5 channel-join credit is not referral income.
    const [[paidTotals]] = await pool.query<Array<RowDataPacket & { total: string; this_month: string }>>(
      `SELECT COALESCE(SUM(amount),0) total,
              COALESCE(SUM(CASE WHEN settled_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
                THEN amount ELSE 0 END),0) this_month
       FROM referral_reward_ledger
       WHERE user_id=? AND status='paid' AND reward_type<>'publisher_join_channel'`,
      [userId],
    );
    const totalEarnedNum = Number(paidTotals?.total || 0);
    const thisMonthNum = Number(paidTotals?.this_month || 0);

    // Active referrals: count referrals who either have commission > 0 OR have active/verified assets
    const [[activeCountRow]] = await pool.query<Array<RowDataPacket & { active_count: number }>>(
      `SELECT COUNT(DISTINCT r.user_id) AS active_count
       FROM referrals r
       WHERE r.invited_by = ?
         AND (
           EXISTS (SELECT 1 FROM referral_revenue_commissions l WHERE l.referrer_user_id = ? AND l.referred_user_id = r.user_id AND l.status='settled')
           OR EXISTS (SELECT 1 FROM referral_commission_ledger l WHERE l.referrer_user_id = ? AND l.referred_publisher_id = r.user_id AND l.status='paid')
           OR EXISTS (SELECT 1 FROM channels c WHERE c.user_id = r.user_id AND c.is_deleted = FALSE AND c.status = 'active')
           OR EXISTS (SELECT 1 FROM miniapps m WHERE m.user_id = r.user_id AND m.status = 'approved')
           OR EXISTS (SELECT 1 FROM bots b WHERE b.user_id = r.user_id AND b.status IN ('active','approved'))
         )`,
      [userId, userId, userId]
    );
    const activeReferrals = Number(activeCountRow?.active_count || 0);

    // 3. Breakdown by monetization product
    const [breakdownRows] = await pool.query<
      Array<RowDataPacket & { product_type: string; volume: string; commission: string; distinct_users: number }>
    >(
      `SELECT product_type,
              COALESCE(SUM(monetized_earning_amount), 0) AS volume,
              COALESCE(SUM(commission_amount), 0) AS commission,
              COUNT(DISTINCT referred_user_id) AS distinct_users
       FROM ${REFERRAL_COMMISSION_ROWS} AS referral_commissions
       WHERE referrer_user_id = ?
       GROUP BY product_type`,
      [userId]
    );
    const breakdownMap: Record<string, { volume: number; commission: number; users: number }> = {
      channel: { volume: 0, commission: 0, users: 0 },
      miniapp: { volume: 0, commission: 0, users: 0 },
      bot: { volume: 0, commission: 0, users: 0 },
      deposit: { volume: 0, commission: 0, users: 0 },
    };
    for (const r of breakdownRows) {
      if (breakdownMap[r.product_type]) {
        breakdownMap[r.product_type] = {
          volume: Number(r.volume || 0),
          commission: Number(r.commission || 0),
          users: Number(r.distinct_users || 0),
        };
      }
    }

    // 4. Achievement Tiers (Bronze: 1-9, Silver: 10-49, Gold: 50-99, Diamond: 100+)
    let currentTier = "Bronze";
    let nextTier: string | null = "Silver";
    let progressPercent = 0;
    if (totalReferrals >= 2000) {
      currentTier = "Diamond";
      nextTier = null;
      progressPercent = 100;
    } else if (totalReferrals >= 500) {
      currentTier = "Gold";
      nextTier = "Diamond";
      progressPercent = Math.min(100, Math.floor(((totalReferrals - 500) / 1500) * 100));
    } else if (totalReferrals >= 100) {
      currentTier = "Silver";
      nextTier = "Gold";
      progressPercent = Math.min(100, Math.floor(((totalReferrals - 100) / 400) * 100));
    } else {
      currentTier = "Bronze";
      nextTier = "Silver";
      progressPercent = Math.min(100, Math.floor((totalReferrals / 100) * 100));
    }

    const tiers = [
      { name: "Bronze", min: 1, max: 99, achieved: totalReferrals >= 1 },
      { name: "Silver", min: 100, max: 499, achieved: totalReferrals >= 100 },
      { name: "Gold", min: 500, max: 1999, achieved: totalReferrals >= 500 },
      { name: "Diamond", min: 2000, max: null, achieved: totalReferrals >= 2000 },
    ];

    // 5. Paginated Referral List with Search, Filter & Sort
    const params: any[] = [userId, userId];
    let whereClause = "WHERE r.invited_by = ?";

    if (search) {
      whereClause += " AND (LOWER(u.first_name) LIKE ? OR LOWER(u.last_name) LIKE ? OR LOWER(u.username) LIKE ?)";
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern);
    }

    if (status === "active") {
      whereClause += ` AND (
        comm.total_commission > 0
        OR EXISTS (SELECT 1 FROM channels c WHERE c.user_id = r.user_id AND c.is_deleted = FALSE AND c.status = 'active')
        OR EXISTS (SELECT 1 FROM miniapps m WHERE m.user_id = r.user_id AND m.status = 'approved')
        OR EXISTS (SELECT 1 FROM bots b WHERE b.user_id = r.user_id AND b.status IN ('active','approved'))
      )`;
    } else if (status === "joined") {
      whereClause += ` AND (
        COALESCE(comm.total_commission, 0) = 0
        AND NOT EXISTS (SELECT 1 FROM channels c WHERE c.user_id = r.user_id AND c.is_deleted = FALSE AND c.status = 'active')
        AND NOT EXISTS (SELECT 1 FROM miniapps m WHERE m.user_id = r.user_id AND m.status = 'approved')
        AND NOT EXISTS (SELECT 1 FROM bots b WHERE b.user_id = r.user_id AND b.status IN ('active','approved'))
      )`;
    }

    // Count total matching
    const [countRows] = await pool.query<Array<RowDataPacket & { total: number }>>(
      `SELECT COUNT(*) AS total
       FROM referrals r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN (
         SELECT referred_user_id, SUM(commission_amount) AS total_commission
         FROM ${REFERRAL_COMMISSION_ROWS} AS referral_commissions
         WHERE referrer_user_id = ?
         GROUP BY referred_user_id
       ) comm ON comm.referred_user_id = r.user_id
       ${whereClause}`,
      params
    );
    const totalItems = Number(countRows[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const offset = (page - 1) * pageSize;

    const orderClause =
      sortBy === "earnings"
        ? "ORDER BY COALESCE(comm.total_commission, 0) DESC, r.id DESC"
        : "ORDER BY r.id DESC";

    const [itemsRows] = await pool.query<
      Array<
        RowDataPacket & {
          id: number;
          user_id: number;
          created_at: string;
          first_name: string | null;
          last_name: string | null;
          username: string | null;
          total_commission: string | null;
          total_volume: string | null;
          channel_count: number;
          miniapp_count: number;
          bot_count: number;
        }
      >
    >(
      `SELECT r.id, r.user_id, r.created_at,
              u.first_name, u.last_name, u.username,
              COALESCE(comm.total_commission, 0) AS total_commission,
              COALESCE(comm.total_volume, 0) AS total_volume,
              (SELECT COUNT(*) FROM channels c WHERE c.user_id = r.user_id AND c.is_deleted = FALSE AND c.status = 'active') AS channel_count,
              (SELECT COUNT(*) FROM miniapps m WHERE m.user_id = r.user_id AND m.status = 'approved') AS miniapp_count,
              (SELECT COUNT(*) FROM bots b WHERE b.user_id = r.user_id AND b.status IN ('active','approved')) AS bot_count
       FROM referrals r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN (
         SELECT referred_user_id,
                SUM(commission_amount) AS total_commission,
                SUM(monetized_earning_amount) AS total_volume
         FROM ${REFERRAL_COMMISSION_ROWS} AS referral_commissions
         WHERE referrer_user_id = ?
         GROUP BY referred_user_id
       ) comm ON comm.referred_user_id = r.user_id
       ${whereClause}
       ${orderClause}
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    const items = itemsRows.map((row) => {
      const comm = Number(row.total_commission || 0);
      const vol = Number(row.total_volume || 0);
      const hasAssets = Number(row.channel_count) + Number(row.miniapp_count) + Number(row.bot_count) > 0;
      const isActive = comm > 0 || hasAssets;

      let maskedUsername = "";
      if (row.username) {
        const u = row.username.replace(/^@/, "");
        maskedUsername = u.length > 3 ? `@${u.slice(0, 1)}***${u.slice(-1)}` : `@${u.slice(0, 1)}***`;
      }

      const displayName =
        [row.first_name, row.last_name].filter(Boolean).join(" ") || maskedUsername || `User #${row.user_id}`;

      return {
        id: row.id,
        userId: row.user_id,
        name: displayName,
        username: maskedUsername,
        joinDate: row.created_at,
        status: isActive ? "active" : "joined",
        hasChannel: Number(row.channel_count) > 0,
        hasMiniApp: Number(row.miniapp_count) > 0,
        hasBot: Number(row.bot_count) > 0,
        volumeUsdt: formatCommissionUsdt(vol),
        commissionUsdt: formatCommissionUsdt(comm),
      };
    });

    // 6. Promotional share presets (Longer, high-converting, professional marketing copy)
    const sharePresets = {
      channels: `📢 Monetize Your Telegram Channel with AdsGalaxy!\n\nTurn your channel views into daily passive income. Join AdsGalaxy to access verified global advertisers, industry-leading CPM/CPC rates, and instant daily payouts directly in USDT.\n\n✨ Zero minimum subscriber threshold to apply\n⚡ Automated ad scheduling with zero spam\n💰 Real-time 10% earnings credited instantly\n\nStart monetizing your channel today:\n👉 ${referralLink}`,
      miniapps: `📱 Monetize Your Telegram Mini App with AdsGalaxy SDK\n\nIntegrate high-fill rewarded videos, interstitial banners, and native ads into your Mini App in under 5 minutes. High CPMs with automated daily payouts in USDT.\n\n⚡ Ultra-lightweight SDK with 99.9% uptime\n🎯 Verified premium advertisers across Web3 & Gaming\n💎 Instant real-time revenue settlement\n\nIntegrate and start earning:\n👉 ${referralLink}`,
      bots: `🤖 Earn Passive Revenue from Your Telegram Bot!\n\nMonetize your Telegram bot effortlessly with AdsGalaxy sponsored broadcasts. Send sponsored messages safely to your subscribers with granular control and guaranteed payouts.\n\n🔒 Anti-spam compliant broadcast architecture\n📊 Transparent real-time delivery and click analytics\n💵 Automated instant payouts directly to your wallet\n\nConnect your bot and begin monetizing:\n👉 ${referralLink}`,
    };

    const [[historyCount]] = await pool.query<Array<RowDataPacket & { count: number }>>(
      "SELECT COUNT(*) count FROM referral_reward_ledger WHERE user_id=? AND status='paid' AND reward_type<>'publisher_join_channel'",
      [userId],
    );
    const [historyRows] = await pool.query<Array<RowDataPacket & { id: number; reward_type: string; amount: string; paid_at: string }>>(
      `SELECT id,reward_type,amount,COALESCE(settled_at,created_at) paid_at
       FROM referral_reward_ledger
       WHERE user_id=? AND status='paid' AND reward_type<>'publisher_join_channel'
       ORDER BY id DESC LIMIT 20 OFFSET ?`,
      [userId, (historyPage - 1) * 20],
    );
    const historyTotal = Number(historyCount?.count || 0);

    return NextResponse.json({
      earningsHistory: {
        items: historyRows.map((row) => ({
          id: row.id,
          label: row.reward_type === "referral_commission" ? "Referral commission"
            : row.reward_type === "publisher_commission" ? "Publisher commission"
            : "Historical referral reward",
          amountUsdt: formatCommissionUsdt(row.amount),
          paidAt: row.paid_at,
        })),
        page: historyPage,
        totalItems: historyTotal,
        totalPages: Math.max(1, Math.ceil(historyTotal / 20)),
      },
      summary: {
        totalReferrals,
        activeReferrals,
        totalEarnedUsdt: formatCommissionUsdt(totalEarnedNum),
        thisMonthUsdt: formatCommissionUsdt(thisMonthNum),
        totalEarnedRaw: totalEarnedNum,
        thisMonthRaw: thisMonthNum,
      },
      breakdown: {
        channels: {
          ...breakdownMap.channel,
          commissionUsdt: formatCommissionUsdt(breakdownMap.channel.commission),
        },
        miniApps: {
          ...breakdownMap.miniapp,
          commissionUsdt: formatCommissionUsdt(breakdownMap.miniapp.commission),
        },
        bots: {
          ...breakdownMap.bot,
          commissionUsdt: formatCommissionUsdt(breakdownMap.bot.commission),
        },
        deposits: {
          ...breakdownMap.deposit,
          commissionUsdt: formatCommissionUsdt(breakdownMap.deposit.commission),
        },
      },
      achievements: {
        currentTier,
        nextTier,
        progressPercent,
        tiers,
      },
      referrals: {
        items,
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages,
        },
      },
      referralCode,
      referralLink,
      sharePresets,
    });
  } catch (error: any) {
    console.error("Referrals Fetch Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch referral data" },
      { status: getAuthErrorStatus(error) }
    );
  }
}
