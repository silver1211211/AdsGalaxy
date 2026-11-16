import { NextResponse } from "next/server";
/* eslint-disable @typescript-eslint/no-explicit-any -- FAQ database rows are dynamically shaped */
import pool from "@/lib/db";
import faqRu from "@/i18n/faqRu.json";

export const dynamic = "force-dynamic";

const publisherFaqsDefault = [
  {
    id: -2001,
    type: "publisher",
    question: "How do I add my Telegram channel?",
    answer: "Go to Publisher > Monetize and tap the + button. Select 'Channel', enter your public channel username (or private invite link), add our bot as admin with posting permissions, then configure your posting schedule and categories. Channels must have at least 100 subscribers.",
  },
  {
    id: -2002,
    type: "publisher",
    question: "How do I monetize a private Telegram channel?",
    answer: "Go to Publisher > Monetize, tap +, and select Channel. Toggle 'Private Channel', paste your private invite link (format: https://t.me/+...), and make sure AdsGalaxy Bot is added as administrator. The platform automatically verifies admin permissions before submission. Once verified, complete the posting schedule and category setup to submit for review.",
  },
  {
    id: -2003,
    type: "publisher",
    question: "How do I monetize a Telegram bot?",
    answer: "Go to Publisher > Monetize, tap + and select Bot. Enter your bot token, set the posting frequency and audience regions, and submit. Once approved, open Monetize > Bot > View Details, copy your Integration URL, and add this integration to your existing /start handler. Your Telegram webhook and existing bot logic remain unchanged. Integration documentation is available under Publisher > Docs.",
  },
  {
    id: -2004,
    type: "publisher",
    question: "How do I monetize a Telegram mini app?",
    answer: "Go to Publisher > Monetize, tap + and select Mini App. After approval, use your numeric Mini App ID from Publisher > Mini Apps > Mini App Details in the AdsGalaxy SDK script and call window.showAdsGalaxy(). An optional signed reward callback can be configured to verify and grant user rewards securely.",
  },
  {
    id: -2005,
    type: "publisher",
    question: "What is the minimum withdrawal amount and what are the fees?",
    answer: "The minimum withdrawal amount is 50 USDT across all publisher assets. We support BEP-20 (Binance Smart Chain) with no network fee ($0.00), TRC-20 (Tron) with a $2.00 fee, and ERC-20 (Ethereum) with a $1.00 fee. The fee is deducted from your withdrawal amount, and payouts are sent directly to your self-custody or exchange wallet.",
  },
  {
    id: -2006,
    type: "publisher",
    question: "Is there an earnings lock period before I can withdraw?",
    answer: "No. There is no earnings lock period on AdsGalaxy. All settled earnings are credited directly to your Available Balance and can be withdrawn immediately once you reach the 50 USDT minimum threshold.",
  },
  {
    id: -2007,
    type: "publisher",
    question: "How are my channel earnings calculated and settled?",
    answer: "Publishers receive 60% of gross advertiser campaign spend. For Channel Views (CPM), earnings are calculated per 1,000 verified views in 1-hour UTC settlement windows. After a 15-minute verification grace period, verified view earnings are credited directly to your available balance. For Channel Clicks (CPC), genuine verified clicks are credited to your balance with automatic zero-click reserve support.",
  },
  {
    id: -2008,
    type: "publisher",
    question: "When will my channel, bot, or mini app be approved?",
    answer: "Asset reviews typically take 24–48 hours. You will receive an automated notification once your asset is approved, or if any adjustments are needed.",
  },
  {
    id: -2009,
    type: "publisher",
    question: "How many ad posts per day can be posted on my channel?",
    answer: "You can configure 1, 2, or 3 ad posts per day when setting up your channel, selected from 48 half-hour daily time slots. Posts remain active on your channel for 24 hours, after which they expire. The same campaign is never reposted to your channel within 24 hours.",
  },
  {
    id: -2010,
    type: "publisher",
    question: "Why does AdsGalaxy Bot need admin rights in my channel?",
    answer: "AdsGalaxy Bot needs administrator permissions solely to post scheduled sponsored ads to your channel. Without admin rights it cannot deliver ads. If the bot is removed or loses admin permissions, ad delivery automatically halts.",
  },
  {
    id: -2011,
    type: "publisher",
    question: "Why was my channel or asset rejected?",
    answer: "Common rejection reasons include having fewer than 100 subscribers, an inactive or bot-inflated audience, missing bot administrator permissions, or content violating platform policies. Check the rejection notice on your dashboard for specific feedback.",
  },
  {
    id: -2012,
    type: "publisher",
    question: "Can I pause my channel or bot?",
    answer: "Yes. You can pause ad delivery at any time from your Publisher dashboard or by contacting support. While paused, no ads will be delivered and no new posts will be scheduled.",
  },
  {
    id: -2013,
    type: "publisher",
    question: "Can I register multiple channels, bots, or mini apps?",
    answer: "Yes. There is no limit on the number of assets you can register. Each channel, bot, and mini app is reviewed, managed, and monetized independently under your account.",
  },
  {
    id: -2014,
    type: "publisher",
    question: "Where can I track my ad earnings and performance?",
    answer: "Go to Publisher > Earnings or Dashboard to view real-time statistics including total impressions, valid clicks, effective CPM rates, available balance, and itemized per-post settlement history.",
  },
];

const advertiserFaqsDefault = [
  {
    id: -3001,
    type: "advertiser",
    question: "How do I create and launch a campaign?",
    answer: "Go to Advertiser > Campaigns and tap 'New Campaign'. Choose your campaign format (Channel Views, Channel Clicks, Bot Broadcast, or Mini App Rewarded Ad), select your audience categories and geographic regions, set your CPM/CPC bid and budget, provide your ad text/media, and submit for review.",
  },
  {
    id: -3002,
    type: "advertiser",
    question: "What campaign formats are available?",
    answer: "We offer four formats: Channel Views (CPM — pay per 1,000 verified post views in Telegram channels), Channel Clicks (CPC — pay per 1,000 verified clicks on your ad link), Bot Broadcast (direct sponsored messages to bot users), and Mini App Rewarded Ads (full-screen engaging interstitial ads inside Telegram mini apps).",
  },
  {
    id: -3003,
    type: "advertiser",
    question: "What are the minimum bid rates and minimum budget?",
    answer: "The minimum campaign budget is $10.00. Minimum bid rates are $3.00 CPM for Channel Views, $65.00 CPC ($0.065 per click) for Channel Clicks, $1.50 CPM for Bot Broadcasts, and $2.50 CPM for Mini App impressions. Higher bids increase priority and exposure on high-traffic, premium channels.",
  },
  {
    id: -3004,
    type: "advertiser",
    question: "How does AdsGalaxy prevent fake views and bot clicks?",
    answer: "AdsGalaxy uses an automated multi-layer fraud detection system. Views and clicks undergo real-time cryptographic verification, IP/user agent validation, and velocity checks. Suspicious, duplicate, or bot traffic is filtered and waived automatically. Advertisers are only charged for genuine, verified views and human clicks.",
  },
  {
    id: -3005,
    type: "advertiser",
    question: "Does the platform lock publisher earnings for 30 days?",
    answer: "No. There is no 30-day earnings lock on the platform. AdsGalaxy uses real-time automated fraud detection and 1-hour settlement windows. Cheating or invalid traffic is caught and filtered at the time of delivery, protecting advertiser budgets immediately without requiring arbitrary holding periods.",
  },
  {
    id: -3006,
    type: "advertiser",
    question: "How is my campaign budget debited?",
    answer: "Your budget is reserved when your campaign is approved. Actual charges are deducted incrementally in real time as genuine views or clicks are confirmed. You only pay for verified delivery.",
  },
  {
    id: -3007,
    type: "advertiser",
    question: "What happens to my unspent campaign budget?",
    answer: "Any unspent budget remains securely in your advertiser account balance (ad_balance) — it is never lost. You can reuse it to launch new campaigns, increase the budget of running campaigns, or adjust targeting at any time.",
  },
  {
    id: -3008,
    type: "advertiser",
    question: "How does geographic and category targeting work?",
    answer: "You can target by continent (Africa, Americas, Asia, Europe, Middle East, Oceania, or Global) and by content category (Crypto, Finance, Tech, Entertainment, Education, Shopping, Gambling, NSFW +18, Other). Ads are algorithmically matched only to channels and bots that fit your selected criteria.",
  },
  {
    id: -3009,
    type: "advertiser",
    question: "How do I deposit funds into my account?",
    answer: "Go to Advertiser > Deposit Fund and select your preferred network. We accept USDT on TRC-20 (Tron), BEP-20 (Binance Smart Chain), and ERC-20 (Ethereum). Your balance is credited automatically after on-chain confirmation.",
  },
  {
    id: -3010,
    type: "advertiser",
    question: "When will my campaign go live?",
    answer: "Campaigns are reviewed for policy compliance, usually within 1–24 hours. Once approved, ad delivery begins automatically during matching publisher posting windows.",
  },
  {
    id: -3011,
    type: "advertiser",
    question: "Can I edit or pause a running campaign?",
    answer: "You can pause a campaign at any time from your dashboard to stop delivery immediately. Settings such as budget limits and status can be managed from the campaign details page, or you can contact support for custom adjustments.",
  },
  {
    id: -3012,
    type: "advertiser",
    question: "What ad content is allowed or prohibited?",
    answer: "Allowed content includes crypto, apps, financial services, education, games, tech products, and legitimate business offers. Prohibited content includes scams, phishing, illegal goods, malware, deceptive schemes, or anything violating Telegram's Terms of Service. Prohibited campaigns are rejected during review.",
  },
  {
    id: -3013,
    type: "advertiser",
    question: "How do I track my campaign's performance?",
    answer: "Open Advertiser > Campaigns and select your campaign to view real-time statistics including impressions, verified clicks, click-through rate (CTR), total spend, and post delivery status across channels.",
  },
];

const referralFaqsDefault = [
  {
    id: -1001,
    type: "referral",
    question: "How does the AdsGalaxy Referral Program work?",
    answer: "Open Publisher > Referral, copy your referral link, and share it with friends and partners. When a user joins AdsGalaxy through your link, they are permanently linked to your account. You earn a 10% lifetime commission on all eligible monetization activity they generate.",
  },
  {
    id: -1002,
    type: "referral",
    question: "What do I earn from my referrals?",
    answer: "You earn a 10% lifetime commission across all four platform revenue streams: 10% of referred publisher channel earnings, 10% of referred publisher bot earnings, 10% of referred publisher mini-app earnings, and 10% of referred advertiser deposit amounts.",
  },
  {
    id: -1003,
    type: "referral",
    question: "When and how are referral commissions paid?",
    answer: "Referral commissions are credited instantly to your Available Balance as soon as your referral's publisher earnings settle or their deposit is confirmed on-chain. There is no earnings lock period or waiting delay.",
  },
  {
    id: -1004,
    type: "referral",
    question: "Are there fixed signup bonuses or Referral Sprints?",
    answer: "No. Historical fixed signup micro-bonuses and competition sprints/leagues have been retired in favor of the transparent 10% lifetime commission model. You earn real cash commissions every time your referrals earn or deposit.",
  },
  {
    id: -1005,
    type: "referral",
    question: "Is there a minimum withdrawal amount for referral earnings?",
    answer: "Referral earnings are credited to your standard publisher available balance. The platform minimum withdrawal is 50 USDT (free on BEP-20, $2 fee on TRC-20, $1 fee on ERC-20).",
  },
  {
    id: -1006,
    type: "referral",
    question: "Is there a limit on how many people I can refer?",
    answer: "There is no limit. You can refer as many publishers and advertisers as you wish. The more active referrals you bring to the platform, the higher your recurring passive earnings.",
  },
  {
    id: -1007,
    type: "referral",
    question: "Can I refer myself or create fake accounts?",
    answer: "No. Self-referrals, reciprocal referral loops, mass account creation, and fraudulent engagement are strictly prohibited and flagged by our anti-abuse system. Violations will result in referral disqualification.",
  },
  {
    id: -1008,
    type: "referral",
    question: "Where can I see my referral earnings and history?",
    answer: "Open Publisher > Referral to see your real-time stats including your unique referral link, total referrals, active referrals, total earned USDT, monthly earnings, and a per-product commission breakdown across Channels, Mini Apps, Bots, and Deposits.",
  },
];

function mergeFaqs(rows: any[], type: string, defaults: { id: number; type: string; question: string; answer: string }[]) {
  const seen = new Set<string>();
  const existing = rows.filter((faq: any) => {
    if (faq.type !== type) return false;
    const key = String(faq.question || "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const existingQuestions = new Set(existing.map((faq: any) => String(faq.question || "").trim().toLowerCase()));
  return [
    ...existing,
    ...defaults.filter((faq) => !existingQuestions.has(faq.question.trim().toLowerCase())),
  ];
}

function localizeFaqs(items: Array<{ id: number; question: string; answer: string }>, locale: string) {
  if (locale !== "ru") return items;
  return items.map((item) => {
    const translated = (faqRu as Record<string, { question: string; answer: string }>)[String(item.id)];
    return translated ? { ...item, question: translated.question, answer: translated.answer } : item;
  });
}

export async function GET(request: Request) {
  try {
    const [rows]: any = await pool.query("SELECT * FROM faqs ORDER BY id ASC");

    const locale = new URL(request.url).searchParams.get("locale") === "ru" ? "ru" : "en";
    return NextResponse.json({
      publisher:  localizeFaqs(mergeFaqs(rows, "publisher", publisherFaqsDefault), locale),
      advertiser: localizeFaqs(mergeFaqs(rows, "advertiser", advertiserFaqsDefault), locale),
      referral:   localizeFaqs(mergeFaqs(rows, "referral", referralFaqsDefault), locale),
    });
  } catch (error: any) {
    console.error("FAQs API Error:", error);
    return NextResponse.json({ error: "Failed to fetch FAQs" }, { status: 500 });
  }
}
