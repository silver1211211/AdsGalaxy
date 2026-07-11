import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");
const telegram = read("src/lib/telegram.ts");
const notifications = read("src/lib/publisherNotifications.ts");
const welcome = read("src/lib/channelWelcomePost.ts");
const channelCreate = read("src/app/api/publisher/channels/route.ts");
const channelActions = read("src/app/api/admin/channels/[id]/actions/route.ts");
const adminChannels = read("src/app/api/admin/channels/route.ts");
const adminBots = read("src/app/api/admin/bots/route.ts");
const subscriberCron = read("src/app/api/cron/update-subscribers/route.ts");
const withdrawals = read("src/app/api/publisher/withdrawals/route.ts");
const audits = read("src/app/api/admin/audits/route.ts");
const auth = read("src/lib/auth.ts");

test("publisher lifecycle and withdrawal HTML notifications use HTML parse mode", () => {
  assert.match(notifications, /sendTelegramMessage\(String\(telegramId\), message, \{ parse_mode: "HTML" \}\)/);
  for (const heading of ["Bot Approved", "Channel Approved", "Mini App Approved", "Withdrawal Completed"]) {
    assert.match(notifications, new RegExp(`<b>${heading}</b>`));
  }
  assert.match(withdrawals, /sendTelegramMessage\(userRows\[0\]\.telegram_id, message, \{ parse_mode: "HTML" \}\)/);
  assert.match(withdrawals, /Address: <code>\$\{escapeTelegramHtml\(address\)\}<\/code>/);
});

test("all confirmed direct HTML Telegram paths use HTML mode and escape dynamic values", () => {
  for (const source of [adminChannels, adminBots, subscriberCron, withdrawals, audits, auth]) {
    assert.match(source, /parse_mode: "HTML"/);
    assert.match(source, /escapeTelegramHtml\(/);
  }
  assert.match(notifications, /escapeTelegramHtml\(title\)/);
  assert.match(notifications, /escapeTelegramHtml\(name\)/);
  assert.match(notifications, /escapeTelegramHtml\(botUsername\)/);
  assert.match(notifications, /escapeTelegramHtml\(input\.reason\)/);
  assert.match(telegram, /replace\(\/&\/g, "&amp;"\)/);
  assert.match(telegram, /replace\(\/<\/g, "&lt;"\)/);
  assert.match(telegram, /replace\(\/>\/g, "&gt;"\)/);
});

test("plain-text Telegram messages are not globally forced into HTML mode", () => {
  assert.match(telegram, /export const SAFE_TELEGRAM_PARSE_MODE = undefined/);
  assert.match(telegram, /const \{ parse_mode = SAFE_TELEGRAM_PARSE_MODE/);
  assert.doesNotMatch(telegram, /SAFE_TELEGRAM_PARSE_MODE = "HTML"/);
});

test("welcome post uses exact approved HTML copy, image environment variable, and atomic claim", () => {
  for (const text of [
    "🚀 <b>Welcome to AdsGalaxy</b>",
    "Your channel has been added and is now under review.",
    "💰 Monetize your Telegram:",
    "• Channels (Public & Private)",
    "• Bots",
    "• Mini Apps",
    "📢 Reach thousands of Telegram users by advertising your products across the AdsGalaxy network.",
    "Start monetizing:",
    "https://t.me/Ads_Galaxy_bot?startapp=REF770190998629F",
  ]) assert.ok(welcome.includes(text), `missing welcome copy: ${text}`);
  assert.match(welcome, /process\.env\.CHANNEL_WELCOME_IMAGE_URL/);
  assert.match(welcome, /photo: imageUrl/);
  assert.match(welcome, /parse_mode: "HTML"/);
  assert.match(welcome, /welcome_post_sent_at IS NULL/);
  assert.match(welcome, /welcome_post_status IS NULL OR welcome_post_status = 'failed'/);
  assert.match(welcome, /SET welcome_post_status = 'sending', welcome_post_attempted_at = NOW\(\)/);
  assert.match(welcome, /welcome_post_message_id = \?/);
  assert.match(welcome, /welcome_post_status = 'failed', welcome_post_failure_reason = \?/);
});

test("only a genuinely new pending channel triggers the welcome post", () => {
  const insertIndex = channelCreate.indexOf("INSERT INTO channels");
  const triggerIndex = channelCreate.indexOf("sendChannelWelcomePostIfNeeded(result.insertId, resolvedChatId)");
  assert.ok(insertIndex >= 0 && triggerIndex > insertIndex);
  assert.equal(channelCreate.match(/sendChannelWelcomePostIfNeeded\(/g)?.length, 1);
  assert.match(channelCreate, /insertParams[\s\S]*"pending"/);
  assert.match(channelCreate, /sendChannelWelcomePostIfNeeded\(result\.insertId, resolvedChatId\)\.catch/);
  assert.doesNotMatch(channelActions, /sendChannelWelcomePostIfNeeded/);
  assert.doesNotMatch(channelActions, /channelWelcomePost/);
});

test("reactivation, approval, resume, and duplicate paths cannot resend welcome post", () => {
  const reactivationReturn = channelCreate.indexOf('message: "Channel reactivated and updated"');
  const freshInsert = channelCreate.indexOf("INSERT INTO channels");
  assert.ok(reactivationReturn >= 0 && reactivationReturn < freshInsert);
  assert.match(channelCreate, /if \(!channel\.is_deleted\)[\s\S]*This channel is already active in your dashboard/);
  assert.doesNotMatch(adminChannels, /sendChannelWelcomePostIfNeeded/);
  assert.doesNotMatch(channelActions, /sendChannelWelcomePostIfNeeded/);
});
