import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import mysql from "mysql2/promise";
import "./reward-callback-production-loader.mjs";

const rawUrl = process.env.ADSGALAXY_BROADCAST_TEST_DATABASE_URL;
if (!rawUrl) throw new Error("ADSGALAXY_BROADCAST_TEST_DATABASE_URL is required");
const parsed = new URL(rawUrl);
assert.ok(["127.0.0.1", "localhost", "::1"].includes(parsed.hostname));
assert.equal(parsed.pathname.slice(1), "adsgalaxy_broadcast_test");
assert.match(parsed.pathname, /adsgalaxy.*test/i);

const prefix = `codex_broadcast_${randomUUID().replaceAll("-", "")}`;
const pool = mysql.createPool({ uri: parsed.href, connectionLimit: 8 });
let services;
let settlement;
let audience;
let advertiserId;
let publisherId;
let campaignId;
let botId;
let botUserId;

before(async () => {
  services = await import("../src/app/api/cron/process-broadcast/route.ts");
  settlement = await import("../src/app/api/cron/settle-broadcast-publishers/route.ts");
  audience = await import("../src/lib/botAudience.ts");
  const [advertiser] = await pool.query(
    "INSERT INTO users (telegram_id,username,ad_balance) VALUES (?,?,?)",
    [`91${Date.now()}`, `${prefix}_advertiser`, 100],
  );
  advertiserId = advertiser.insertId;
  const [publisher] = await pool.query(
    "INSERT INTO users (telegram_id,username,balance_available) VALUES (?,?,0)",
    [`92${Date.now()}`, `${prefix}_publisher`],
  );
  publisherId = publisher.insertId;
  const [campaign] = await pool.query(
    `INSERT INTO campaigns (user_id,name,type,budget,total_budget,cpm,category,continents,status)
     VALUES (?,?, 'broadcast',1,1,1000,'tech','["NA"]','active')`,
    [advertiserId, `${prefix}_campaign`],
  );
  campaignId = campaign.insertId;
  const [bot] = await pool.query(
    `INSERT INTO bots
       (user_id,bot_name,bot_username,bot_token,integration_secret_encrypted,integration_secret_hash,status,health_status,categories,continents)
     VALUES (?,?,?,?,?,?,'active','healthy','["tech"]','["NA"]')`,
    [publisherId, `${prefix}_bot`, `${prefix}_bot`, "test-token", "encrypted", "a".repeat(64)],
  );
  botId = bot.insertId;
  const [botUser] = await pool.query(
    `INSERT INTO bot_users (bot_id,user_id,chat_id,is_active,status,source,integration_first_seen_at)
     VALUES (?,?,?,TRUE,'active','integration',NOW())`,
    [botId, `${prefix}_recipient`, `93${Date.now()}`],
  );
  botUserId = botUser.insertId;
});

after(async () => {
  await pool.query("DELETE FROM broadcast_deliveries WHERE campaign_id=?", [campaignId]);
  await pool.query("DELETE FROM bot_users WHERE bot_id=?", [botId]);
  await pool.query("DELETE FROM bots WHERE id=?", [botId]);
  await pool.query("DELETE FROM campaigns WHERE id=?", [campaignId]);
  await pool.query("DELETE FROM users WHERE id IN (?,?)", [advertiserId, publisherId]);
  const [remaining] = await pool.query(
    `SELECT
      (SELECT COUNT(*) FROM campaigns WHERE name LIKE ?) campaigns,
      (SELECT COUNT(*) FROM bots WHERE bot_name LIKE ?) bots,
      (SELECT COUNT(*) FROM users WHERE username LIKE ?) users`,
    [`${prefix}%`, `${prefix}%`, `${prefix}%`],
  );
  assert.deepEqual(remaining[0], { campaigns: 0, bots: 0, users: 0 });
  const [triggers] = await pool.query(
    "SELECT COUNT(*) count FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name LIKE ?",
    [`${prefix}%`],
  );
  assert.equal(triggers[0].count, 0);
  await pool.end();
});

test("production recipient condition accepts verified reachable users and excludes the publisher owner", async () => {
  const [eligible] = await pool.query(
    `SELECT bu.id FROM bot_users bu JOIN bots b ON b.id=bu.bot_id
     WHERE bu.id=? AND ${audience.botUserBroadcastEligibleCondition("bu", "b")}`,
    [botUserId],
  );
  assert.equal(eligible.length, 1);
  await pool.query("UPDATE bot_users SET chat_id=(SELECT telegram_id FROM users WHERE id=?) WHERE id=?", [publisherId, botUserId]);
  const [owner] = await pool.query(
    `SELECT bu.id FROM bot_users bu JOIN bots b ON b.id=bu.bot_id
     WHERE bu.id=? AND ${audience.botUserBroadcastEligibleCondition("bu", "b")}`,
    [botUserId],
  );
  assert.equal(owner.length, 0);
  await pool.query("UPDATE bot_users SET chat_id=? WHERE id=?", [`93${Date.now()}`, botUserId]);
});

test("successful production reservation debits once and finalizes one earning", async () => {
  const input = {
    campaign: { id: campaignId },
    bot: { id: botId },
    user: { id: botUserId, chat_id: `93${Date.now()}` },
    cost: 1,
  };
  const reserved = await services.reserveBroadcastDelivery(input, pool);
  assert.equal(reserved.ok, true);
  await services.finalizeBroadcastDelivery({
    deliveryId: reserved.deliveryId,
    campaign: input.campaign,
    bot: input.bot,
    user: input.user,
    payout: { publisherReward: 0.3, reserveAmount: 0.1, platformRevenue: 0.6 },
    attempts: 1,
  }, pool);
  const [rows] = await pool.query("SELECT status,cost,publisher_reward FROM broadcast_deliveries WHERE id=?", [reserved.deliveryId]);
  assert.equal(rows[0].status, "sent");
  assert.equal(Number(rows[0].cost), 1);
  assert.equal(Number(rows[0].publisher_reward), 0.3);
});

test("terminal failure refunds exactly once", async () => {
  await pool.query("UPDATE campaigns SET budget=1,status='active',pause_reason=NULL WHERE id=?", [campaignId]);
  const reserved = await services.reserveBroadcastDelivery({
    campaign: { id: campaignId }, bot: { id: botId }, user: { id: botUserId, chat_id: "94001" }, cost: 1,
  }, pool);
  const first = await services.refundBroadcastReservation({
    deliveryId: reserved.deliveryId, campaignId, failureReason: "telegram_timeout", telegramError: "timeout", attempts: 3,
  }, pool);
  const second = await services.refundBroadcastReservation({
    deliveryId: reserved.deliveryId, campaignId, failureReason: "telegram_timeout", telegramError: "timeout", attempts: 3,
  }, pool);
  assert.equal(first.refunded, true);
  assert.equal(second.idempotent, true);
  const [[campaign]] = await pool.query("SELECT budget FROM campaigns WHERE id=?", [campaignId]);
  assert.equal(Number(campaign.budget), 1);
});

test("simultaneous final-budget reservations allow exactly one debit", async () => {
  await pool.query("UPDATE campaigns SET budget=1,status='active',pause_reason=NULL WHERE id=?", [campaignId]);
  const make = (chat) => services.reserveBroadcastDelivery({
    campaign: { id: campaignId }, bot: { id: botId }, user: { id: botUserId, chat_id: chat }, cost: 1,
  }, pool);
  const outcomes = await Promise.all([make("95001"), make("95002")]);
  assert.equal(outcomes.filter((item) => item.ok).length, 1);
  const [[campaign]] = await pool.query("SELECT budget FROM campaigns WHERE id=?", [campaignId]);
  assert.equal(Number(campaign.budget), 0);
});

test("publisher settlement is idempotent and failed deliveries are not settled", async () => {
  const [[sent]] = await pool.query(
    "SELECT id FROM broadcast_deliveries WHERE campaign_id=? AND status='sent' ORDER BY id LIMIT 1",
    [campaignId],
  );
  const first = await settlement.settleBroadcastPublisherDelivery(sent.id, pool);
  const second = await settlement.settleBroadcastPublisherDelivery(sent.id, pool);
  assert.equal(first.settled, true);
  assert.equal(second.idempotent, true);
  const [[publisher]] = await pool.query("SELECT balance_available FROM users WHERE id=?", [publisherId]);
  assert.equal(Number(publisher.balance_available), 0.3);
  const [[failed]] = await pool.query(
    "SELECT id FROM broadcast_deliveries WHERE campaign_id=? AND status='failed' ORDER BY id DESC LIMIT 1",
    [campaignId],
  );
  assert.equal((await settlement.settleBroadcastPublisherDelivery(failed.id, pool)).settled, false);
});
