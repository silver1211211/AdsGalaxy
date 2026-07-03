if (process.env.NODE_ENV === 'production') {
  throw new Error('init-db.js is disabled in production. Use versioned migrations.');
}

if (process.env.ALLOW_DESTRUCTIVE_DB_INIT !== 'YES_I_UNDERSTAND') {
  throw new Error('Destructive database initialization is disabled. Set ALLOW_DESTRUCTIVE_DB_INIT=YES_I_UNDERSTAND only for an expendable local database.');
}

const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env' });

async function initDB() {
  console.log("Connecting to the database...");
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'adsfusion',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  try {
    console.log("Starting Database Initialization...\n");

    // 1. Disable foreign key checks so we can safely drop/create
    await pool.query('SET FOREIGN_KEY_CHECKS = 0;');

    // 2. Drop all tables if they exist
    console.log("Dropping existing tables to start fresh...");
    await pool.query('DROP TABLE IF EXISTS `withdrawals`');
    await pool.query('DROP TABLE IF EXISTS `users`');
    await pool.query('DROP TABLE IF EXISTS `settings`');
    await pool.query('DROP TABLE IF EXISTS `referrals`');
    await pool.query('DROP TABLE IF EXISTS `faqs`');
    await pool.query('DROP TABLE IF EXISTS `deposits`');
    await pool.query('DROP TABLE IF EXISTS `channels`');
    await pool.query('DROP TABLE IF EXISTS `campaign_views_audit`');
    await pool.query('DROP TABLE IF EXISTS `campaign_posts`');
    await pool.query('DROP TABLE IF EXISTS `campaign_limits`');
    await pool.query('DROP TABLE IF EXISTS `campaign_clicks`');
    await pool.query('DROP TABLE IF EXISTS `campaigns`');
    await pool.query('DROP TABLE IF EXISTS `ad_settlements_views`');
    await pool.query('DROP TABLE IF EXISTS `ad_settlements`');
    await pool.query('DROP TABLE IF EXISTS `advertiser_transactions`');
    await pool.query('DROP TABLE IF EXISTS `admins`');
    // 3. Create all tables
    console.log("\nCreating tables...");

    console.log(" -> Creating table: admins");
    await pool.query(`
CREATE TABLE \`admins\` (
  \`id\` int(11)
    `);

    console.log(" -> Creating table: advertiser_transactions");
    await pool.query(`
CREATE TABLE \`advertiser_transactions\` (
  \`id\` int(11)
    `);

    console.log(" -> Creating table: ad_settlements");
    await pool.query(`
CREATE TABLE \`ad_settlements\` (
  \`id\` int(11)
    `);

    console.log(" -> Creating table: ad_settlements_views");
    await pool.query(`
CREATE TABLE \`ad_settlements_views\` (
  \`id\` int(11)
    `);

    console.log(" -> Creating table: campaigns");
    await pool.query(`
CREATE TABLE \`campaigns\` (
  \`id\` int(11)
    `);

    console.log(" -> Creating table: campaign_clicks");
    await pool.query(`
CREATE TABLE \`campaign_clicks\` (
  \`id\` int(11)
    `);

    console.log(" -> Creating table: campaign_limits");
    await pool.query(`
CREATE TABLE \`campaign_limits\` (
  \`id\` int(11)
    `);

    console.log(" -> Creating table: campaign_posts");
    await pool.query(`
CREATE TABLE \`campaign_posts\` (
  \`id\` int(11)
    `);

    console.log(" -> Creating table: campaign_views_audit");
    await pool.query(`
CREATE TABLE \`campaign_views_audit\` (
  \`id\` int(11)
    `);

    console.log(" -> Creating table: channels");
    await pool.query(`
CREATE TABLE \`channels\` (
  \`id\` int(11)
    `);

    console.log(" -> Creating table: deposits");
    await pool.query(`
CREATE TABLE \`deposits\` (
  \`id\` int(11)
    `);

    console.log(" -> Creating table: faqs");
    await pool.query(`
CREATE TABLE \`faqs\` (
  \`id\` int(11)
    `);

    console.log(" -> Creating table: referrals");
    await pool.query(`
CREATE TABLE \`referrals\` (
  \`id\` int(11)
    `);

    console.log(" -> Creating table: settings");
    await pool.query(`
CREATE TABLE \`settings\` (
  \`key\` varchar(255)
    `);

    console.log(" -> Creating table: users");
    await pool.query(`
CREATE TABLE \`users\` (
  \`id\` int(11)
    `);

    console.log(" -> Creating table: withdrawals");
    await pool.query(`
CREATE TABLE \`withdrawals\` (
  \`id\` int(11)
    `);

    // 4. Insert essential initial data
    console.log("\nInserting initial data for configuration tables...");

    console.log(" -> Populating table: admins");
    await pool.query(`
INSERT INTO \`admins\` (\`id\`, \`username\`, \`password\`, \`password_hash\`, \`password_migrated_at\`, \`created_at\`) VALUES
(1, 'admin', '[migrated]', '$2b$12$OeVbk9w3XYEloyRXEUj7cebHFDxlJ8XKbT8J1OXIAWK/YONQ7XXWa', NOW(), '2026-05-02 09:03:54');
    `);

    console.log(" -> Populating table: campaign_limits");
    await pool.query(`
INSERT INTO \`campaign_limits\` (\`id\`, \`budget_threshold\`, \`daily_placement_limit\`) VALUES
(1, 100.00, 5),
(2, 200.00, 15);
    `);

    console.log(" -> Populating table: faqs");
    await pool.query(`
INSERT INTO \`faqs\` (\`id\`, \`question\`, \`answer\`, \`type\`, \`created_at\`, \`updated_at\`) VALUES
(1, 'How do I add my channel?', 'Go to your Publisher Dashboard, navigate to My Channels, and click the \\"Add Channel\\" button. Follow the instructions to authenticate your Telegram channel.', 'publisher', '2026-05-02 08:13:53', '2026-05-02 08:13:53'),
(2, 'When do I get paid?', 'Earnings from your active campaigns are calculated automatically. Once your earnings exceed the 30-day lock period, they are transferred to your available balance and can be withdrawn.', 'publisher', '2026-05-02 08:13:53', '2026-05-02 08:13:53'),
(3, 'How are ad limits calculated?', 'Your ad placement frequency is determined by the advertiser\\'s budget and your channel\\'s specific settings. The platform automatically balances ad distribution.', 'publisher', '2026-05-02 08:13:53', '2026-05-02 08:13:53'),
(4, 'How do I create a new campaign?', 'On your Advertiser Dashboard, click \\"Create Campaign\\". You will need to set a budget, choose your target audience, and provide the ad creative.', 'advertiser', '2026-05-02 08:13:53', '2026-05-02 08:13:53'),
(5, 'What happens if publisher use fake bots views to a post to increase their earning?', 'Our platform prevents cheating by locking publisher earnings for 30 days. We actively audit post views, and any suspicious activity is flagged. If you suspect fake views on your campaign, contact admin with the post ID from the campaign details page.\\r\\n', 'advertiser', '2026-05-02 08:13:53', '2026-05-02 08:30:29'),
(6, 'How can I track my ad performance?', 'Your Advertiser Dashboard provides real-time statistics including total views, total clicks, and the amount of your budget spent.', 'advertiser', '2026-05-02 08:13:53', '2026-05-02 08:13:53'),
(7, 'When my referral commission will be added ? ', 'You get your commission once your friends unlock their incomes. ', 'publisher', '2026-05-02 08:13:53', '2026-05-02 08:13:53'),
(8, 'On how many channel my ad will be posted?', 'Your ad placement will be based on your cpm and budget of the campaign plus number of publishers available.', 'advertiser', '2026-05-02 08:13:53', '2026-05-02 08:41:16');
    `);

    console.log(" -> Populating table: settings");
    await pool.query(`
INSERT INTO \`settings\` (\`key\`, \`value\`, \`description\`) VALUES
('last_cron_run', '1777626412309', 'Timestamp of the last successful cron run'),
('last_settlement_run', '1777699824537', 'Timestamp of the last settlement cron run'),
('last_settlement_views_run', '0', 'Timestamp of the last views settlement cron run'),
('last_views_check', '1777632872570', 'Timestamp of the last views update cron run'),
('max_cpm_clicks', '20.00', 'Maximum CPM for click campaigns'),
('max_cpm_views', '5.00', 'Maximum CPM for view campaigns'),
('max_withdraw', '500.00', 'Maximum withdrawal amount per request'),
('min_campaign_budget', '10.00', 'Minimum initial campaign budget'),
('min_cpm_clicks', '2.00', 'Minimum CPM for click campaigns'),
('min_cpm_views', '0.50', 'Minimum CPM for view campaigns'),
('min_deposit_amount', '0.1', 'Minimum deposit amount'),
('min_withdraw', '10.00', 'Minimum withdrawal amount'),
('platform_margin_percent', '40', 'Channel campaign advertiser debit retained as AdsGalaxy platform margin'),
('referral_percent', '5', 'Percentage earned from referral earnings'),
('safety_reserve_percent', '10', 'Percent of the post-margin channel publisher pool retained as safety reserve');
    `);

    // 5. Re-enable foreign key checks
    await pool.query('SET FOREIGN_KEY_CHECKS = 1;');

    console.log("\n✅ Database initialization completed successfully!");
  } catch (error) {
    console.error("\n❌ Error initializing database:");
    console.error(error.message);
  } finally {
    await pool.end();
  }
}

initDB();
