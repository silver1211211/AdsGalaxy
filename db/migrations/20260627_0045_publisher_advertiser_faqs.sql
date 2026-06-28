-- Publisher and Advertiser FAQs

INSERT IGNORE INTO faqs (question, answer, type) VALUES
  ('How do I add my Telegram channel?', 'Go to Publisher > Monetize and tap the + button. Select ''Channel'', enter your public channel username, add our bot as admin, then continue to configure your posting schedule and categories.', 'publisher'),
  ('When will my channel be approved?', 'Channel reviews typically take 1–3 business days. You''ll receive a notification once your channel is approved or if additional information is needed.', 'publisher'),
  ('How does ad posting work on my channel?', 'Once approved, our system automatically posts sponsored ads to your channel at the times you configured. You control the number of posts per day (1–3) and preferred posting times.', 'publisher'),
  ('How are my earnings calculated?', 'You earn based on the CPM (cost per thousand views or clicks) of each ad posted to your channel. Earnings depend on your channel''s subscriber count, category, and audience region.', 'publisher'),
  ('What is the minimum withdrawal amount?', 'The minimum withdrawal amount is $10. You can withdraw to BEP-20 (no fee), TRC-20 ($2 fee), or ERC-20 ($1 fee) wallet addresses.', 'publisher'),
  ('What withdrawal networks are supported?', 'We support BEP-20 (Binance Smart Chain) with no network fee, TRC-20 (Tron) with a $2 fee, and ERC-20 (Ethereum) with a $1 fee. The fee is deducted from your withdrawal amount.', 'publisher'),
  ('Why was my channel rejected?', 'Common rejection reasons include: the channel does not meet our minimum subscriber threshold, content violates our policies, or the bot was not added as admin. Check the rejection notice for the specific reason.', 'publisher'),
  ('Can I pause my channel?', 'Yes. Contact support to temporarily pause ad delivery to your channel. While paused, no ads will be posted and no earnings will accrue.', 'publisher'),
  ('How many ads per day can be posted?', 'You can configure 1, 2, or 3 ad posts per day when setting up your channel. This can be adjusted by contacting support.', 'publisher'),
  ('What content categories are supported?', 'Supported categories include Crypto, Finance, Tech, Entertainment, Education, Shopping, Gambling, NSFW +18, and Other. You can select up to 3 categories that best describe your channel''s audience.', 'publisher'),

  ('How do I create a campaign?', 'Go to Advertiser > Campaigns and tap ''New Campaign''. Choose between a Channel campaign (views or clicks) or a Bot Broadcast campaign, set your CPM bid and budget, add your ad content, and submit for review.', 'advertiser'),
  ('What is CPM and how is it calculated?', 'CPM stands for Cost Per Mille — the price you pay per 1,000 views or clicks. Your total spend equals (CPM ÷ 1000) × number of views or clicks delivered.', 'advertiser'),
  ('What campaign types are available?', 'We offer Channel Views campaigns (pay per 1,000 post views), Channel Clicks campaigns (pay per 1,000 link clicks), and Bot Broadcast campaigns (direct sponsored messages to bot users).', 'advertiser'),
  ('How is my budget charged?', 'Your budget is reserved when the campaign is approved. Actual charges are deducted as views or clicks are delivered. Any unspent budget is refunded if the campaign ends early.', 'advertiser'),
  ('When will my campaign go live?', 'Campaigns are reviewed by our team, usually within 1–3 business days. Once approved, ad delivery begins automatically during the next available posting window.', 'advertiser'),
  ('How do I track campaign performance?', 'Open Advertiser > Campaigns and select your campaign to view real-time stats including impressions, clicks, CTR, and total spend.', 'advertiser'),
  ('What is the minimum campaign budget?', 'The minimum campaign budget is $10. This ensures sufficient delivery to measure meaningful performance for your ad.', 'advertiser'),
  ('Can I edit a running campaign?', 'Running campaigns cannot be edited directly. Pause the campaign first, then contact support if you need to update the ad content or budget.', 'advertiser'),
  ('How does channel targeting work?', 'Your ads are distributed across publisher channels that match your selected audience regions and categories. Higher CPM bids increase priority and reach on premium channels.', 'advertiser'),
  ('How do I deposit funds?', 'Go to Advertiser > Deposit Fund and choose a payment method. Supported methods include USDT (TRC-20, ERC-20, BEP-20). Funds are credited after on-chain confirmation.', 'advertiser');
