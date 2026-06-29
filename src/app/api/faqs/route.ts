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
  {
    id: -2011,
    type: "publisher",
    question: "How do I monetize a private Telegram channel?",
    answer: "Go to Publisher > Monetize, tap +, and select Channel. Toggle 'Private Channel', paste your private invite link (format: https://t.me/+...), and make sure AdsGalaxy Bot is added as administrator. The platform checks that the bot has admin access before proceeding. Once verified, complete the posting schedule and category setup to submit for review.",
  },
  {
    id: -2012,
    type: "publisher",
    question: "How do I monetize a Telegram bot?",
    answer: "Go to Publisher > Monetize, tap + and select Bot. Enter your bot token, set the posting frequency and audience regions, and submit. Once approved, set up the AdsGalaxy webhook on your bot — open Monetize > Bot > View Details to copy the webhook URL, then register it with Telegram via setWebhook. The docs page under Publisher > Docs > Bots includes a ready-to-run curl command.",
  },
  {
    id: -2013,
    type: "publisher",
    question: "How do I monetize a Telegram mini app?",
    answer: "Go to Publisher > Monetize, tap + and select Mini App. Enter the mini app name, username, linked bot ID, Web App URL, and direct mini app URL, then submit for review. After approval, add the AdsGalaxy SDK script tag to your mini app HTML and call window.showAdsGalaxy() wherever you want to trigger an ad. The full integration guide is in Publisher > Docs > Mini Apps.",
  },
  {
    id: -2014,
    type: "publisher",
    question: "What is the difference between locked and available balance?",
    answer: "Locked balance is earnings attributed to your account that are still going through settlement review — this typically clears within a few hours to one day. Available balance is the amount ready to withdraw immediately. Both are shown on your publisher dashboard. Withdrawals are only processed from your available balance.",
  },
  {
    id: -2015,
    type: "publisher",
    question: "Why does AdsGalaxy Bot need admin rights in my channel?",
    answer: "AdsGalaxy Bot needs administrator permissions to post sponsored ads to your channel. Without admin rights it cannot post, and your channel will receive no ad revenue. If the bot is removed or loses admin rights, ad delivery pauses automatically and your channel's health status will flag the issue.",
  },
  {
    id: -2016,
    type: "publisher",
    question: "What happens if AdsGalaxy Bot is removed from my channel?",
    answer: "If AdsGalaxy Bot loses admin rights or is removed from your channel, ad delivery stops automatically. Your channel may be paused and flagged as 'bot removed'. Re-add the bot as administrator, then use the Resume option in Publisher > Monetize or contact support to restore delivery.",
  },
  {
    id: -2017,
    type: "publisher",
    question: "Can I register multiple channels, bots, or mini apps?",
    answer: "Yes. There is no set limit on the number of assets you can register. Each channel, bot, and mini app is reviewed individually and must meet the platform's quality requirements. All approved assets earn independently and their combined performance is visible on your dashboard.",
  },
  {
    id: -2018,
    type: "publisher",
    question: "How do I track my ad earnings and activity?",
    answer: "Go to Publisher > Earnings to see a full breakdown of ad settlements, locked and available amounts, and per-campaign details. Your dashboard shows a summary of total impressions, clicks, and CTR across all your monetized assets. Each asset's individual stats are also shown on the Monetize page.",
  },
  {
    id: -2019,
    type: "publisher",
    question: "Why is my channel or bot showing $0.00 in earnings?",
    answer: "Earnings only accumulate after ads are actively delivered to your asset. If your channel or bot was recently approved, ads may not have been scheduled yet. If the asset is active with a healthy status and earnings are still $0.00, check that ad posts are actually appearing in your channel or being delivered through your bot, and that your categories and audience settings match active advertiser campaigns.",
  },
  {
    id: -2020,
    type: "publisher",
    question: "How does posting time configuration work?",
    answer: "During channel setup you can select preferred time windows for ad delivery. AdsGalaxy will schedule posts within those windows when matching campaigns are available. If no custom times are configured, the platform uses default delivery windows. Posting time preferences help you control when ads appear so they fit naturally with your channel's regular content schedule.",
  },
  {
    id: -2021,
    type: "publisher",
    question: "How does ad delivery work for mini apps?",
    answer: "Mini app ads are triggered by your code — you call window.showAdsGalaxy() inside your mini app when you want to show an ad, for example when a user requests a reward. AdsGalaxy returns an available ad if one exists for your audience. Earnings are recorded per confirmed impression. If no ad is available, the SDK returns a no-fill signal so your app can handle it gracefully.",
  },
  {
    id: -2022,
    type: "publisher",
    question: "What categories should I select for my channel or bot?",
    answer: "Choose the categories that best describe your actual audience. Accurate categories help the platform match your asset with relevant advertiser campaigns, which directly affects how often your channel receives ads and at what CPM rate. You can select up to 3 categories. Misrepresenting your audience can result in fewer matching campaigns or a policy review.",
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
  {
    id: -3011,
    type: "advertiser",
    question: "What is a bot broadcast campaign?",
    answer: "A bot broadcast campaign delivers your sponsored message directly to users of registered Telegram bots — not inside a channel, but as a direct message to each bot subscriber. You are charged per 1,000 messages successfully delivered. This is useful for reaching active bot users with personalized or interactive content.",
  },
  {
    id: -3012,
    type: "advertiser",
    question: "What is a mini app rewarded ad?",
    answer: "A mini app rewarded ad displays a full-screen advertisement inside a Telegram mini app when the publisher triggers it via the AdsGalaxy SDK. Users watch or interact with the ad in exchange for a reward inside the mini app. You pay per confirmed impression. This format delivers high engagement because users actively choose to see the ad.",
  },
  {
    id: -3013,
    type: "advertiser",
    question: "What is the difference between a views campaign and a clicks campaign?",
    answer: "A views campaign charges you per 1,000 post views — impressions registered when channel subscribers see the ad post. A clicks campaign charges you per 1,000 clicks on the link in your ad. Views campaigns typically achieve broader reach at lower CPM; clicks campaigns are better for performance-focused goals where you want to measure direct traffic from the ad.",
  },
  {
    id: -3014,
    type: "advertiser",
    question: "What ad content is allowed on the platform?",
    answer: "Allowed content includes: crypto and finance offers, apps, tech products, education, entertainment, legal commercial promotions, and similar categories. Not allowed: scams, phishing links, content impersonating other brands, illegal services, and anything that violates Telegram's Terms of Service. Campaigns with prohibited content are rejected during review. Repeated policy violations may result in account suspension.",
  },
  {
    id: -3015,
    type: "advertiser",
    question: "What happens to my unspent campaign budget?",
    answer: "Any budget not spent during a campaign remains in your advertiser account balance — it is never lost. You can apply the remaining balance to your next campaign. If a campaign ends early due to budget exhaustion or manual stopping, the undelivered portion stays available for reuse.",
  },
  {
    id: -3016,
    type: "advertiser",
    question: "Why was my campaign rejected?",
    answer: "Common rejection reasons include: ad content that violates platform policies, a destination link that is unreachable or leads to prohibited content, an incomplete ad copy, or an insufficient budget. The rejection notice includes a specific reason. Fix the identified issue and resubmit the campaign, or contact support if you believe the rejection was made in error.",
  },
  {
    id: -3017,
    type: "advertiser",
    question: "Can I target specific individual Telegram channels?",
    answer: "No. You cannot select individual channels directly. Your campaign is matched and distributed across all publisher channels that overlap with your chosen audience regions and categories. Higher CPM bids increase your campaign's delivery priority, giving you more exposure on premium, high-subscriber channels.",
  },
  {
    id: -3018,
    type: "advertiser",
    question: "What audience regions can I target?",
    answer: "You can target by continent: Africa, Americas, Asia, Europe, Middle East, and Oceania. Selecting multiple regions broadens your reach. Publishers declare their channel's primary audience region during setup, and campaigns are matched to publishers with overlapping regions. Targeting a single high-value region (such as Europe or Americas) with a higher CPM can improve result quality.",
  },
  {
    id: -3019,
    type: "advertiser",
    question: "Can I run multiple campaigns at the same time?",
    answer: "Yes. You can create and run multiple campaigns simultaneously. Each campaign has its own budget, targeting, and performance tracking. Running parallel campaigns with different creatives or targeting combinations is a good way to compare performance and optimize your spend.",
  },
  {
    id: -3020,
    type: "advertiser",
    question: "How long does it take for a deposit to be credited?",
    answer: "USDT deposits are credited after on-chain confirmation. TRC-20 (Tron) is typically the fastest, confirming within a few minutes. BEP-20 (Binance Smart Chain) is also quick. ERC-20 (Ethereum) can take longer depending on network congestion. Once the required confirmations are reached, your balance is updated automatically.",
  },
  {
    id: -3021,
    type: "advertiser",
    question: "How do I increase my campaign's delivery and reach?",
    answer: "Raise your CPM bid to compete more effectively for placement on high-traffic channels. Broaden your audience region and category selections to increase the pool of matching publishers. Make sure your ad creative and destination link comply with platform policies so the campaign passes review without delays.",
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
  {
    id: -1013,
    type: "referral",
    question: "What Telegram channel must my referral join to complete verification?",
    answer: "Your referral must join the official AdsGalaxy Telegram community channel. The exact channel link and join button are shown directly on the Referral verification page inside AdsGalaxy. Once the referred user joins and taps Verify inside the app, the system confirms their membership and releases your verification reward.",
  },
  {
    id: -1014,
    type: "referral",
    question: "How long does it take for a referral reward to be credited?",
    answer: "The join reward is typically credited within a few minutes of your referral opening AdsGalaxy through your link. The verification reward is credited shortly after the referred user successfully verifies their channel membership. Rewards that trigger an abuse review may take longer. Check Publisher > Referral for the current status of each referral.",
  },
  {
    id: -1015,
    type: "referral",
    question: "Is there a limit on how many people I can refer?",
    answer: "There is no fixed cap on referrals. You can share your referral link with as many people as you like and earn a reward for each completed, verified referral. Anti-abuse checks apply to all referrals — only genuine, unique users who are not already registered will count toward rewards.",
  },
  {
    id: -1016,
    type: "referral",
    question: "What happens if a referred user gets banned?",
    answer: "If a referred user's account is banned for policy violations, their referral rewards may be withheld or reversed depending on when the ban occurs. Rewards that were already fully settled to your available balance before the ban are generally not clawed back. Referrals under active abuse review will not be paid until the review concludes.",
  },
  {
    id: -1017,
    type: "referral",
    question: "Can a person I referred also earn money as a publisher?",
    answer: "Yes. Anyone who joins AdsGalaxy through your referral link can go on to register their own channels, bots, or mini apps and earn as a publisher independently. Their publisher earnings are entirely their own and separate from the referral reward you receive for bringing them in.",
  },
  {
    id: -1018,
    type: "referral",
    question: "When are sprint leaderboard rewards and milestone bonuses paid?",
    answer: "Sprint rewards and milestone bonuses are settled by the platform after the sprint period ends and final results are confirmed. The payout timeline depends on the sprint configuration. You will see the pending bonus on your Referral page, and it will move to your available balance once processing is complete.",
  },
  {
    id: -1019,
    type: "referral",
    question: "Do referral rewards expire?",
    answer: "Referral rewards already credited to your available balance do not expire and can be withdrawn at any time once the minimum withdrawal threshold is met. Rewards in a pending state — waiting for your referral to complete channel verification — will remain pending until verification is completed or the referral times out per platform policy.",
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
