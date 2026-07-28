import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import mysql from "mysql2/promise";
import "./reward-callback-production-loader.mjs";

const databaseUrl = process.env.ADSGALAXY_CAMPAIGN_TEST_DATABASE_URL;
const skipReason = databaseUrl ? false : "ADSGALAXY_CAMPAIGN_TEST_DATABASE_URL is not configured";
const prefix = `codex_campaign_${randomUUID().replaceAll("-", "")}`;
let pool;
let transactionService;
let validation;
let readiness;
const userIds = new Set();

function safeDatabaseUrl() {
  const parsed = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(parsed.hostname), "campaign test DB must be local");
  assert.equal(parsed.pathname.slice(1), "adsgalaxy_campaign_test");
  assert.match(parsed.pathname, /adsgalaxy.*test/i);
  return parsed.href;
}

async function counts() {
  const [campaigns] = await pool.query("SELECT COUNT(*) count FROM campaigns WHERE name LIKE ?", [`${prefix}%`]);
  const [users] = await pool.query("SELECT COUNT(*) count FROM users WHERE username LIKE ?", [`${prefix}%`]);
  const [ledger] = await pool.query("SELECT COUNT(*) count FROM advertiser_transactions WHERE description LIKE ?", [`${prefix}%`]);
  const [targets] = await pool.query(
    "SELECT COUNT(*) count FROM campaign_direct_inventory_targets t JOIN campaigns c ON c.id=t.campaign_id WHERE c.name LIKE ?",
    [`${prefix}%`],
  );
  const [exclusions] = await pool.query(
    "SELECT COUNT(*) count FROM campaign_inventory_exclusions e JOIN campaigns c ON c.id=e.campaign_id WHERE c.name LIKE ?",
    [`${prefix}%`],
  );
  return { campaigns: campaigns[0].count, users: users[0].count, ledger: ledger[0].count, targets: targets[0].count, exclusions: exclusions[0].count };
}

async function cleanup() {
  if (!pool) return;
  const ids = [...userIds];
  if (ids.length) {
    const [campaignRows] = await pool.query("SELECT id FROM campaigns WHERE user_id IN (?) AND name LIKE ?", [ids, `${prefix}%`]);
    const campaignIds = campaignRows.map((row) => row.id);
    if (campaignIds.length) {
      await pool.query("DELETE FROM campaign_direct_inventory_targets WHERE campaign_type='campaign' AND campaign_id IN (?)", [campaignIds]);
      await pool.query("DELETE FROM campaign_inventory_exclusions WHERE campaign_type='campaign' AND campaign_id IN (?)", [campaignIds]);
      await pool.query("DELETE FROM campaigns WHERE id IN (?)", [campaignIds]);
    }
    await pool.query("DELETE FROM advertiser_transactions WHERE user_id IN (?) AND description LIKE ?", [ids, `${prefix}%`]);
    await pool.query("DELETE FROM users WHERE id IN (?) AND username LIKE ?", [ids, `${prefix}%`]);
  }
}

async function createUser(balance) {
  const username = `${prefix}_${userIds.size}`;
  const [result] = await pool.query("INSERT INTO users (telegram_id, username, ad_balance) VALUES (?, ?, ?)", [`9${Date.now()}${userIds.size}`, username, balance]);
  userIds.add(result.insertId);
  return result.insertId;
}

async function createAttempt({ userId, objective, budget = 10, suffix = objective, failAfterInsert = false }) {
  const type = validation.validateCampaignObjective(objective);
  const conn = await pool.getConnection();
  try {
    return await transactionService.executeCampaignCreationTransaction({
      conn,
      userId,
      budget,
      description: `${prefix}_${suffix}`,
      createCampaign: async (db) => {
        const [result] = await db.query(
          `INSERT INTO campaigns
            (user_id, name, campaign_title, message_text, type, budget, total_budget, cpm, cpc, category,
             countries, languages, direct_placement_mode, direct_inventory_scope, direct_inventory_metadata, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'all', ?, ?, 'network', 'network', ?, 'pending')`,
          [userId, `${prefix}_${suffix}`, "Integration campaign", "Integration message", type, budget, budget,
            type === "clicks" ? 5 : 2, type === "clicks" ? 5 : 0, JSON.stringify(["US"]), JSON.stringify(["en"]),
            JSON.stringify({ inventory_type: type === "broadcast" ? "bot" : "channel" })],
        );
        const inventoryType = type === "broadcast" ? "bot" : "channel";
        await db.query(
          "INSERT INTO campaign_direct_inventory_targets (campaign_type, campaign_id, inventory_type, inventory_id) VALUES ('campaign', ?, ?, ?)",
          [result.insertId, inventoryType, 900000000 + result.insertId],
        );
        await db.query(
          "INSERT INTO campaign_inventory_exclusions (campaign_type, campaign_id, inventory_type, normalized_identifier) VALUES ('campaign', ?, ?, ?)",
          [result.insertId, inventoryType, `${prefix.slice(0, 32)}_${result.insertId}`.slice(0, 64)],
        );
        if (failAfterInsert) throw new Error("forced post-debit failure");
        return result.insertId;
      },
    });
  } finally {
    conn.release();
  }
}

before(async () => {
  if (skipReason) return;
  pool = mysql.createPool(safeDatabaseUrl());
  transactionService = await import("../src/lib/campaignCreationTransaction.ts");
  validation = await import("../src/lib/campaignCreationValidation.ts");
  readiness = await import("../src/lib/campaignCreationReadiness.ts");
  assert.deepEqual(await counts(), { campaigns: 0, users: 0, ledger: 0, targets: 0, exclusions: 0 });
  await readiness.assertCampaignCreationSchemaReady(pool);
});

after(async () => {
  if (!pool) return;
  await cleanup();
  assert.deepEqual(await counts(), { campaigns: 0, users: 0, ledger: 0, targets: 0, exclusions: 0 });
  const [triggers] = await pool.query("SELECT COUNT(*) count FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME LIKE ?", [`${prefix}%`]);
  assert.equal(triggers[0].count, 0);
  await pool.end();
});

for (const objective of ["views", "clicks", "broadcast"]) {
  test(`real MySQL ${objective} creation commits matching campaign, mapping, debit, and ledger`, { skip: skipReason }, async () => {
    const userId = await createUser(30);
    const result = await createAttempt({ userId, objective });
    const [campaigns] = await pool.query("SELECT type, budget, cpc, direct_inventory_metadata FROM campaigns WHERE id=?", [result.id]);
    const [users] = await pool.query("SELECT ad_balance FROM users WHERE id=?", [userId]);
    const [ledger] = await pool.query("SELECT amount, type FROM advertiser_transactions WHERE user_id=? AND description=?", [userId, `${prefix}_${objective}`]);
    const [targets] = await pool.query("SELECT inventory_type FROM campaign_direct_inventory_targets WHERE campaign_id=?", [result.id]);
    const [exclusions] = await pool.query("SELECT inventory_type FROM campaign_inventory_exclusions WHERE campaign_id=?", [result.id]);
    assert.equal(campaigns[0].type, objective);
    assert.equal(Number(users[0].ad_balance), 20);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].type, "debit");
    assert.equal(targets[0].inventory_type, objective === "broadcast" ? "bot" : "channel");
    assert.equal(exclusions[0].inventory_type, objective === "broadcast" ? "bot" : "channel");
    if (objective === "clicks") assert.equal(Number(campaigns[0].cpc), 5);
  });
}

test("invalid objectives mutate no real MySQL state", { skip: skipReason }, async () => {
  const userId = await createUser(70);
  const beforeBalance = 70;
  for (const objective of ["CHANNEL", "BOT", "BOTH", "unknown", "VIEWS", "", undefined]) {
    assert.throws(() => validation.validateCampaignObjective(objective), (error) => error.code === "INVALID_CAMPAIGN_TYPE");
  }
  const [users] = await pool.query("SELECT ad_balance FROM users WHERE id=?", [userId]);
  const [campaigns] = await pool.query("SELECT id FROM campaigns WHERE user_id=?", [userId]);
  const [ledger] = await pool.query("SELECT id FROM advertiser_transactions WHERE user_id=?", [userId]);
  assert.equal(Number(users[0].ad_balance), beforeBalance);
  assert.equal(campaigns.length, 0);
  assert.equal(ledger.length, 0);
});

test("missing-schema readiness uses only read-only SQL and mutates nothing", { skip: skipReason }, async () => {
  const userId = await createUser(20);
  const attempted = [];
  const simulatedMissingColumnDb = {
    async query(sql, values) {
      attempted.push(sql);
      const [rows] = await pool.query(sql, values);
      return [rows.filter((row) => !(row.table_name === "campaigns" && row.column_name === "campaign_title"))];
    },
  };
  await assert.rejects(readiness.assertCampaignCreationSchemaReady(simulatedMissingColumnDb), (error) => error.code === "CAMPAIGN_SCHEMA_NOT_READY");
  assert.equal(attempted.length, 1);
  assert.doesNotMatch(attempted[0], /\b(?:ALTER|CREATE|DROP)\b/i);
  const [users] = await pool.query("SELECT ad_balance FROM users WHERE id=?", [userId]);
  assert.equal(Number(users[0].ad_balance), 20);
});

test("post-debit failure rolls back campaign, targeting, exclusion, ledger, and balance", { skip: skipReason }, async () => {
  const userId = await createUser(20);
  await assert.rejects(createAttempt({ userId, objective: "views", suffix: "rollback", failAfterInsert: true }), /forced post-debit failure/);
  const [users] = await pool.query("SELECT ad_balance FROM users WHERE id=?", [userId]);
  const [campaigns] = await pool.query("SELECT id FROM campaigns WHERE user_id=? AND name=?", [userId, `${prefix}_rollback`]);
  const [ledger] = await pool.query("SELECT id FROM advertiser_transactions WHERE user_id=? AND description=?", [userId, `${prefix}_rollback`]);
  assert.equal(Number(users[0].ad_balance), 20);
  assert.equal(campaigns.length, 0);
  assert.equal(ledger.length, 0);
});

test("two independent connections permit exactly one guarded debit", { skip: skipReason }, async () => {
  const userId = await createUser(10);
  const outcomes = await Promise.allSettled([
    createAttempt({ userId, objective: "views", suffix: "race_a" }),
    createAttempt({ userId, objective: "views", suffix: "race_b" }),
  ]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  const rejected = outcomes.find((item) => item.status === "rejected");
  assert.equal(rejected.reason.code, "INSUFFICIENT_AD_BALANCE");
  const [users] = await pool.query("SELECT ad_balance FROM users WHERE id=?", [userId]);
  const [campaigns] = await pool.query("SELECT id FROM campaigns WHERE user_id=? AND name LIKE ?", [userId, `${prefix}_race_%`]);
  const [ledger] = await pool.query("SELECT id FROM advertiser_transactions WHERE user_id=? AND description LIKE ?", [userId, `${prefix}_race_%`]);
  assert.equal(Number(users[0].ad_balance), 0);
  assert.equal(campaigns.length, 1);
  assert.equal(ledger.length, 1);
});

test("unexpected real SQL failure is sanitized and fully rolled back", { skip: skipReason }, async () => {
  const userId = await createUser(20);
  const conn = await pool.getConnection();
  let caught;
  try {
    await transactionService.executeCampaignCreationTransaction({
      conn, userId, budget: 10, description: `${prefix}_sql_error`,
      createCampaign: async (db) => {
        await db.query("INSERT INTO table_that_must_not_exist_for_campaign_test (id) VALUES (1)");
        return 1;
      },
    });
  } catch (error) {
    caught = error;
  } finally {
    conn.release();
  }
  const publicFailure = validation.classifyCampaignCreateFailure(caught);
  assert.equal(publicFailure.status, 500);
  assert.equal(publicFailure.body.code, "CAMPAIGN_CREATE_FAILED");
  assert.doesNotMatch(JSON.stringify(publicFailure.body), /table_that|SQL|constraint/i);
  const [users] = await pool.query("SELECT ad_balance FROM users WHERE id=?", [userId]);
  const [ledger] = await pool.query("SELECT id FROM advertiser_transactions WHERE user_id=?", [userId]);
  assert.equal(Number(users[0].ad_balance), 20);
  assert.equal(ledger.length, 0);
});
