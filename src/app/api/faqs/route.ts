import { NextResponse } from "next/server";
import pool from "@/lib/db";

const publisherFaqsDefault = [
  {
    id: -2001,
    type: "publisher",
    question: "How do I add my Telegram channel?",
    answer: "Go to Publisher > Monetize and tap the + button. Select 'Channel', enter your public channel username, add our bot as admin, then continue to configure your posting schedule and categories.",
  },
  {
    id: -2002,
    type: "publisher",
    question: "When will my channel be approved?",
    answer: "Channel reviews typically take 1–3 business days. You'll receive a notification once your channel is approved or if additional information is needed.",
  },
  {
    id: -2003,
    type: "publisher",
    question: "How does ad posting work on my channel?",
    answer: "Once approved, our system automatically posts sponsored ads to your channel at the times you configured. You control the number of posts per day (1–3) and preferred posting times.",
  },
  {
    id: -2004,
    type: "publisher",
    question: "How are my earnings calculated?",
    answer: "You earn based on the CPM (cost per thousand views or clicks) of each ad posted to your channel. Earnings depend on your channel's subscriber count, category, and audience region.",
  },
  {
    id: -2005,
    type: "publisher",
    question: "What is the minimum withdrawal amount?",
    answer: "The minimum withdrawal amount is $10. You can withdraw to BEP-20 (no fee), TRC-20 ($2 fee), or ERC-20 ($1 fee) wallet addresses.",
  },
  {
    id: -2006,
    type: "publisher",
    question: "What withdrawal networks are supported?",
    answer: "We support BEP-20 (Binance Smart Chain) with no network fee, TRC-20 (Tron) with a $2 fee, and ERC-20 (Ethereum) with a $1 fee. The fee is deducted from your withdrawal amount.",
  },
  {
    id: -2007,
    type: "publisher",
    question: "Why was my channel rejected?",
    answer: "Common rejection reasons include: the channel does not meet our minimum subscriber threshold, content violates our policies, or the bot was not added as admin. Check the rejection notice for the specific reason.",
  },
  {
    id: -2008,
    type: "publisher",
    question: "Can I pause my channel?",
    answer: "Yes. Contact support to temporarily pause ad delivery to your channel. While paused, no ads will be posted and no earnings will accrue.",
  },
  {
    id: -2009,
    type: "publisher",
    question: "How many ads per day can be posted?",
    answer: "You can configure 1, 2, or 3 ad posts per day when setting up your channel. This can be adjusted by contacting support.",
  },
  {
    id: -2010,
    type: "publisher",
    question: "What content categories are supported?",
    answer: "Supported categories include Crypto, Finance, Tech, Entertainment, Education, Shopping, Gambling, NSFW +18, and Other. You can select up to 3 categories that best describe your channel's audience.",
  },
];

const advertiserFaqsDefault = [
  {
    id: -3001,
    type: "advertiser",
    question: "How do I create a campaign?",
    answer: "Go to Advertiser > Campaigns and tap 'New Campaign'. Choose between a Channel campaign (views or clicks) or a Bot Broadcast campaign, set your CPM bid and budget, add your ad content, and submit for review.",
  },
  {
    id: -3002,
    type: "advertiser",
    question: "What is CPM and how is it calculated?",
    answer: "CPM stands for Cost Per Mille — the price you pay per 1,000 views or clicks. Your total spend equals (CPM ÷ 1000) × number of views or clicks delivered.",
  },
  {
    id: -3003,
    type: "advertiser",
    question: "What campaign types are available?",
    answer: "We offer Channel Views campaigns (pay per 1,000 post views), Channel Clicks campaigns (pay per 1,000 link clicks), and Bot Broadcast campaigns (direct sponsored messages to bot users).",
  },
  {
    id: -3004,
    type: "advertiser",
    question: "How is my budget charged?",
    answer: "Your budget is reserved when the campaign is approved. Actual charges are deducted as views or clicks are delivered. Any unspent budget is refunded if the campaign ends early.",
  },
  {
    id: -3005,
    type: "advertiser",
    question: "When will my campaign go live?",
    answer: "Campaigns are reviewed by our team, usually within 1–3 business days. Once approved, ad delivery begins automatically during the next available posting window.",
  },
  {
    id: -3006,
    type: "advertiser",
    question: "How do I track campaign performance?",
    answer: "Open Advertiser > Campaigns and select your campaign to view real-time stats including impressions, clicks, CTR, and total spend.",
  },
  {
    id: -3007,
    type: "advertiser",
    question: "What is the minimum campaign budget?",
    answer: "The minimum campaign budget is $10. This ensures sufficient delivery to measure meaningful performance for your ad.",
  },
  {
    id: -3008,
    type: "advertiser",
    question: "Can I edit a running campaign?",
    answer: "Running campaigns cannot be edited directly. Pause the campaign first, then contact support if you need to update the ad content or budget.",
  },
  {
    id: -3009,
    type: "advertiser",
    question: "How does channel targeting work?",
    answer: "Your ads are distributed across publisher channels that match your selected audience regions and categories. Higher CPM bids increase priority and reach on premium channels.",
  },
  {
    id: -3010,
    type: "advertiser",
    question: "How do I deposit funds?",
    answer: "Go to Advertiser > Deposit Fund and choose a payment method. Supported methods include USDT (TRC-20, ERC-20, BEP-20). Funds are credited after on-chain confirmation.",
  },
];

const referralFaqs = [
  {
    id: -1001,
    type: "referral",
    question: "How do I invite people with my referral link?",
    answer: "Open Publisher > Referral, copy your referral link, and share it with friends. A referral is tracked when a new user opens AdsGalaxy through your link.",
  },
  {
    id: -1002,
    type: "referral",
    question: "How much do I earn per referral?",
    answer: "You earn $0.005 when your referral first joins AdsGalaxy, plus $0.010 when they join the required Telegram channel and verify successfully. The total standard reward is $0.015 per completed referral.",
  },
  {
    id: -1003,
    type: "referral",
    question: "When is the first referral reward paid?",
    answer: "The $0.005 join reward is paid after a new user joins AdsGalaxy through your referral link. Duplicate, self, or suspicious referral activity may be blocked by anti-abuse checks.",
  },
  {
    id: -1004,
    type: "referral",
    question: "How does the channel verification bonus work?",
    answer: "After your referred user joins the required AdsGalaxy Telegram channel and taps Verify, the system checks their membership. If verification succeeds, you receive the additional $0.010 bonus.",
  },
  {
    id: -1005,
    type: "referral",
    question: "Why is a referral still pending?",
    answer: "A referral can stay pending if the user has joined AdsGalaxy but has not yet verified the required Telegram channel, or if the system is reviewing the referral for abuse signals.",
  },
  {
    id: -1006,
    type: "referral",
    question: "What is the Referral Sprint?",
    answer: "Referral Sprint is a competition where verified referrals count toward leaderboards, milestone rewards, and team rewards while the sprint is active.",
  },
  {
    id: -1007,
    type: "referral",
    question: "How do I join the Referral Sprint?",
    answer: "If Referral Sprint is enabled, open Publisher > Referral and share your referral link. Your eligible verified referrals are counted automatically during the active sprint.",
  },
  {
    id: -1008,
    type: "referral",
    question: "What counts on the sprint leaderboard?",
    answer: "The sprint leaderboard counts referrals that complete required channel verification and pass abuse checks during the sprint. Join-only referrals earn the join reward but do not count as verified leaderboard referrals until verification is complete.",
  },
  {
    id: -1009,
    type: "referral",
    question: "What are referral milestones?",
    answer: "Milestones are extra rewards unlocked when you reach configured verified-referral targets, such as 3, 10, or more verified referrals. Available milestones are shown on the Referral page.",
  },
  {
    id: -1010,
    type: "referral",
    question: "How does Team League work?",
    answer: "Team League unlocks after you reach the required verified-referral count. Once unlocked, you are placed into a permanent team and your verified referrals can help your team compete for rewards.",
  },
  {
    id: -1011,
    type: "referral",
    question: "Can I refer myself or create fake accounts?",
    answer: "No. Self-referrals, reciprocal referral loops, mass account creation, and other suspicious activity can be rejected by anti-abuse checks and may prevent rewards from being paid.",
  },
  {
    id: -1012,
    type: "referral",
    question: "Where can I see my referral earnings and history?",
    answer: "Open Publisher > Referral to see your referral link, total earnings, pending and verified referrals, sprint rank, milestone progress, and referral history.",
  },
];

function mergeFaqs(rows: any[], type: string, defaults: { id: number; type: string; question: string; answer: string }[]) {
  const existing = rows.filter((faq: any) => faq.type === type);
  const existingQuestions = new Set(existing.map((faq: any) => String(faq.question || "").trim().toLowerCase()));
  return [
    ...existing,
    ...defaults.filter((faq) => !existingQuestions.has(faq.question.trim().toLowerCase())),
  ];
}

export async function GET() {
  try {
    const [rows]: any = await pool.query("SELECT * FROM faqs ORDER BY id ASC");

    return NextResponse.json({
      publisher:  mergeFaqs(rows, "publisher",  publisherFaqsDefault),
      advertiser: mergeFaqs(rows, "advertiser", advertiserFaqsDefault),
      referral:   mergeFaqs(rows, "referral",   referralFaqs),
    });
  } catch (error: any) {
    console.error("FAQs API Error:", error);
    return NextResponse.json({ error: "Failed to fetch FAQs" }, { status: 500 });
  }
}
