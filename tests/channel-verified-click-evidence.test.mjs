import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { createRequire } from "node:module";
dotenv.config({ path: ".env", quiet: true });
const require = createRequire(import.meta.url);
const js = ts.transpileModule(fs.readFileSync("src/lib/channelVerifiedClickEvidence.ts", "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
new Function("module", "exports", "require", js)(mod, mod.exports, require);
const { writeChannelClickEvidence: write, CHANNEL_CLICK_EVIDENCE_VERSION } = mod.exports;
const schema = `test_channel_click_evidence_${Date.now()}`;
const quote = name => `\u0060${name}\u0060`;
const secret = "isolated-test-click-evidence-secret-0123456789";
const start = Date.parse("2026-01-01T10:00:00Z") / 1000;
const end = start + 3600;
const opts = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASS };
const input = (sourceClickId, campaignId=10, postId=100, publisherId=2) =>
  ({ sourceClickId, campaignId, postId, publisherId, hashSecret: secret });

test("invalid source identities fail before database access", async () => {
  const db = { getConnection() { throw new Error("unexpected_database_access"); } };
  await assert.rejects(write(db, input(0)), /invalid_identity/);
  await assert.rejects(write(db, input(1, -1)), /invalid_identity/);
  await assert.rejects(write(db, input(Number.MAX_SAFE_INTEGER+1)), /invalid_identity/);
});
test("missing privacy secret fails before database access", async () => {
  const db = { getConnection() { throw new Error("unexpected_database_access"); } };
  await assert.rejects(write(db, { ...input(1), hashSecret: "short" }), /hash_secret_unavailable/);
});

test("disposable MariaDB canonical click evidence", async t => {
  const admin = await mysql.createConnection({ ...opts, database: process.env.DB_NAME });
  let pool, created = false;
  try {
    assert.match(schema, /^test_channel_click_evidence_\d+$/);
    await admin.query(`CREATE DATABASE ${quote(schema)}`); created = true;
    pool = mysql.createPool({ ...opts, database: schema, connectionLimit: 6, decimalNumbers: false });
    const ddl = [
      "CREATE TABLE users (id BIGINT PRIMARY KEY,ad_balance DECIMAL(20,8),balance_available DECIMAL(20,8)) ENGINE=InnoDB",
      "CREATE TABLE campaigns (id BIGINT PRIMARY KEY,user_id BIGINT,type VARCHAR(20),campaign_kind VARCHAR(32)) ENGINE=InnoDB",
      "CREATE TABLE channels (id BIGINT PRIMARY KEY,user_id BIGINT) ENGINE=InnoDB",
      "CREATE TABLE campaign_posts (id BIGINT PRIMARY KEY,campaign_id BIGINT,channel_id BIGINT,status VARCHAR(24),deleted_at DATETIME NULL,delivery_confirmed_at TIMESTAMP NULL) ENGINE=InnoDB",
      "CREATE TABLE campaign_clicks (id BIGINT PRIMARY KEY,campaign_id BIGINT,post_id BIGINT,fingerprint VARCHAR(255),is_bot TINYINT,created_at TIMESTAMP) ENGINE=InnoDB",
      "CREATE TABLE channel_fraud_events (id BIGINT PRIMARY KEY,campaign_id BIGINT NULL,channel_id BIGINT,post_id BIGINT NULL,billing_state VARCHAR(32),false_positive_at DATETIME NULL) ENGINE=InnoDB",
      "CREATE TABLE channel_cpm_settlement_windows (id BIGINT UNSIGNED PRIMARY KEY,campaign_id BIGINT UNSIGNED,start_epoch BIGINT UNSIGNED,end_epoch BIGINT UNSIGNED,status VARCHAR(16)) ENGINE=InnoDB",
      "CREATE TABLE channel_cpm_allocation_plans (id BIGINT PRIMARY KEY,window_id BIGINT UNSIGNED) ENGINE=InnoDB",
      "CREATE TABLE channel_unified_settlement_events (id BIGINT PRIMARY KEY,advertiser_debit DECIMAL(20,8),publisher_credit DECIMAL(20,8),platform_revenue DECIMAL(20,8),reserve_contribution DECIMAL(20,8)) ENGINE=InnoDB",
    ];
    for (const statement of ddl) await pool.query(statement);
    const migration = fs.readFileSync("db/migrations/20261103_1230_channel_click_evidence.sql", "utf8");
    for (const statement of migration.split(";").map(s => s.trim()).filter(Boolean)) await pool.query(statement);
    await pool.query("INSERT INTO users VALUES (1,100,0),(2,0,10),(3,0,5)");
    await pool.query("INSERT INTO channel_unified_settlement_events VALUES (1,1.00000000,0.60000000,0.30000000,0.10000000)");
    await pool.query("INSERT INTO campaigns VALUES (10,1,'views',NULL),(11,1,'views',NULL),(12,1,'clicks',NULL)");
    await pool.query("INSERT INTO channels VALUES (20,2),(21,3)");
    await pool.query("INSERT INTO campaign_posts VALUES (100,10,20,'active',NULL,FROM_UNIXTIME(?)),(101,10,20,'active',NULL,FROM_UNIXTIME(?)),(102,10,21,'active',NULL,FROM_UNIXTIME(?)),(103,11,20,'active',NULL,FROM_UNIXTIME(?)),(104,10,20,'pending_delivery',NULL,NULL),(105,12,20,'active',NULL,FROM_UNIXTIME(?))",
      Array(5).fill(start - 3600));
    await pool.query("INSERT INTO channel_cpm_settlement_windows VALUES (1,10,?,?,'pending'),(2,10,?,?,'pending'),(3,11,?,?,'pending')",
      [start,end,end,end+3600,start,end]);
    async function click(id,campaign,post,fingerprint,bot,epoch) {
      await pool.query("INSERT INTO campaign_clicks VALUES (?,?,?,?,?,FROM_UNIXTIME(?))",
        [id,campaign,post,fingerprint,bot,epoch]);
    }
    await click(1,10,100,"f1",0,start);
    await click(2,10,100,"bot",1,start+600);
    await click(3,10,100,"f1",0,start+600);
    await click(4,10,100,"boundary",0,end);
    await click(5,11,103,"other-campaign",0,start+100);
    await click(6,10,102,"other-publisher",0,start+100);
    await click(7,10,101,"other-post",0,start+100);
    await click(8,10,104,"unposted",0,start+100);
    await click(9,999,100,"missing-campaign",0,start+100);
    await click(10,10,999,"missing-post",0,start+100);
    await click(11,10,100,"future",0,Date.parse("2030-01-01T00:00:00Z")/1000);
    await click(12,10,100,null,0,start+100);
    await click(13,10,100,"fraud",0,start+100);
    await click(14,10,100,"sealed",0,start+100);
    await click(15,12,105,"cpc",0,start+100);
    await click(16,10,100,"concurrent",0,start+100);
    await click(17,10,100,"rollback",0,start+100);
    await click(18,10,100,"no-window",0,start-100);
    await pool.query("INSERT INTO channel_fraud_events VALUES (1,10,20,100,'suspicious',NULL)");
    await t.test("canonical server click is attributable but remains unverified", async () => {
      await pool.query("UPDATE channel_fraud_events SET false_positive_at=FROM_UNIXTIME(?) WHERE id=1",[start]);
      const r = await write(pool,input(1));
      assert.deepEqual([r.outcome,r.reason,r.windowId,r.eventEpoch,r.replayed],
        ["observed_unverified","insufficient_independent_verification",1,start,false]);
      const [[stored]] = await pool.query("SELECT source_type,validation_version,provenance,dedup_hash,ingested_at FROM channel_click_evidence WHERE source_click_id=1");
      assert.equal(stored.source_type,"campaign_clicks");
      assert.equal(stored.validation_version,CHANNEL_CLICK_EVIDENCE_VERSION);
      assert.equal(stored.provenance,"server_redirect");
      assert.match(stored.dedup_hash,/^[a-f0-9]{64}$/);
      assert.ok(stored.ingested_at);
      assert.ok(new Date(stored.ingested_at).getTime() > start*1000);
    });
    await t.test("exact retry and conflicting replay", async () => {
      const r=await write(pool,input(1));assert.equal(r.replayed,true);
      await assert.rejects(write(pool,input(1,11)),/campaign_conflict/);
      await pool.query("UPDATE campaign_clicks SET fingerprint='mutated' WHERE id=1");
      await assert.rejects(write(pool,input(1)),/conflicting_replay/);
      await pool.query("UPDATE campaign_clicks SET fingerprint='f1' WHERE id=1");
      const [[count]]=await pool.query("SELECT COUNT(*) n FROM channel_click_evidence WHERE source_click_id=1");
      assert.equal(count.n,1);
    });
    await t.test("unknown source, campaign, post, and wrong attribution fail closed", async () => {
      await assert.rejects(write(pool,input(999)),/unknown_source_click/);
      await assert.rejects(write(pool,input(9,999)),/unknown_campaign/);
      await assert.rejects(write(pool,input(10,10,999)),/unknown_post/);
      await assert.rejects(write(pool,input(5,10,103)),/campaign_conflict/);
      await assert.rejects(write(pool,input(6,10,102,2)),/publisher_conflict/);
      await assert.rejects(write(pool,input(7,10,100,2)),/post_conflict/);
    });
    await t.test("bot, duplicate, and unpublished post are rejected", async () => {
      assert.deepEqual([ (await write(pool,input(2))).outcome,(await write(pool,input(2))).reason ],["rejected","bot_flag"]);
      assert.equal((await write(pool,input(3))).reason,"duplicate_observation");
      assert.equal((await write(pool,input(8,10,104))).reason,"post_not_confirmed_at_click");
    });
    await t.test("UTC half-open windows, campaign, publisher, post isolation", async () => {
      assert.equal((await write(pool,input(4))).windowId,2);
      assert.equal((await write(pool,input(5,11,103))).windowId,3);
      assert.equal((await write(pool,input(6,10,102,3))).publisherId,3);
      assert.equal((await write(pool,input(7,10,101))).postId,101);
      assert.equal((await write(pool,input(18))).windowId,null);
      assert.equal((await write(pool,input(18))).reason,"window_unavailable");
    });
    await t.test("future, no identity, fraud, sealed plan, and CPC stay unverified or rejected", async () => {
      assert.equal((await write(pool,input(11))).reason,"future_event_timestamp");
      assert.equal((await write(pool,input(12))).reason,"dedup_identity_unavailable");
      await pool.query("UPDATE channel_fraud_events SET false_positive_at=NULL WHERE id=1");
      assert.equal((await write(pool,input(13))).reason,"unresolved_fraud_signal");
      await pool.query("UPDATE channel_fraud_events SET false_positive_at=FROM_UNIXTIME(?) WHERE id=1",[start]);
      await pool.query("INSERT INTO channel_cpm_allocation_plans VALUES (1,1)");
      assert.equal((await write(pool,input(14))).reason,"window_already_planned");
      assert.equal((await write(pool,input(15,12,105))).reason,"not_cpm_campaign");
    });
    await t.test("concurrent attempts yield one evidence row", async () => {
      const results=await Promise.all(Array.from({length:5},()=>write(pool,input(16))));
      assert.equal(results.filter(r=>!r.replayed).length,1);
      assert.equal(results.filter(r=>r.replayed).length,4);
      const [[row]]=await pool.query("SELECT COUNT(*) n FROM channel_click_evidence WHERE source_click_id=16");
      assert.equal(row.n,1);
    });
    await t.test("failed insert rolls back and can retry", async () => {
      await pool.query("CREATE TRIGGER test_click_fail BEFORE INSERT ON channel_click_evidence FOR EACH ROW IF NEW.source_click_id=17 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected_failure'; END IF");
      await assert.rejects(write(pool,input(17)),/injected_failure/);
      const [[row]]=await pool.query("SELECT COUNT(*) n FROM channel_click_evidence WHERE source_click_id=17");
      assert.equal(row.n,0);
      await pool.query("DROP TRIGGER test_click_fail");
      assert.equal((await write(pool,input(17))).replayed,false);
    });
    await t.test("evidence is immutable, privacy conscious, and financially inert", async () => {
      await assert.rejects(pool.query("UPDATE channel_click_evidence SET reason='changed' WHERE source_click_id=1"),/click_evidence_immutable/);
      await assert.rejects(pool.query("DELETE FROM channel_click_evidence WHERE source_click_id=1"),/click_evidence_immutable/);
      const [columns]=await pool.query("SHOW COLUMNS FROM channel_click_evidence");
      assert.ok(!columns.some(c=>/ip_address|user_agent|fingerprint|telegram_user_id/.test(c.Field)));
      const [users]=await pool.query("SELECT id,ad_balance,balance_available FROM users ORDER BY id");
      assert.deepEqual(users.map(u=>[u.ad_balance,u.balance_available]),
        [["100.00000000","0.00000000"],["0.00000000","10.00000000"],["0.00000000","5.00000000"]]);
      const [[validated]]=await pool.query("SELECT COUNT(*) n FROM channel_click_evidence WHERE outcome='validated'");
      assert.equal(validated.n,0);
      const [[financial]]=await pool.query("SELECT advertiser_debit,publisher_credit,platform_revenue,reserve_contribution FROM channel_unified_settlement_events WHERE id=1");
      assert.deepEqual([financial.advertiser_debit,financial.publisher_credit,financial.platform_revenue,financial.reserve_contribution],
        ["1.00000000","0.60000000","0.30000000","0.10000000"]);
    });
  } finally {
    if (pool) await pool.end();
    if (created) await admin.query(`DROP DATABASE ${quote(schema)}`);
    await admin.end();
  }
});
