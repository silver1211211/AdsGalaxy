import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { createRequire } from "node:module";
dotenv.config({path:".env",quiet:true});
const nativeRequire=createRequire(import.meta.url);
function load(path,deps={}) {
  const js=ts.transpileModule(fs.readFileSync(path,"utf8"),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const m={exports:{}};
  new Function("module","exports","require",js)(m,m.exports,name=>deps[name]??nativeRequire(name));
  return m.exports;
}
const math=load("src/lib/channelAllocationMath.ts");
const reader=load("src/lib/channelCpmWindowEngagement.ts",{"@/lib/channelAllocationMath":math});
const redistribution=load("src/lib/channelCpmRedistribution.ts");
const planner=load("src/lib/channelCpmWindowAllocationPlan.ts",{
  "@/lib/channelAllocationMath":math,
  "@/lib/channelCpmWindowEngagement":reader,
  "@/lib/channelCpmRedistribution":redistribution,
});
const {discoverCpmWindows:discover,inspectCpmWindow:inspect}=load("src/lib/channelCpmWindowDiscovery.ts",{
  "@/lib/channelAllocationMath":math,
});
const opts={host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASS};
const schema="test_cpm_discovery_"+Date.now(),quote=n=>"\u0060"+n+"\u0060";
const fixed=Date.parse("2026-01-01T10:00:00Z")/1000;

test("disposable MariaDB CPM window discovery",async t=>{
  const admin=await mysql.createConnection({...opts,database:process.env.DB_NAME});
  let pool,created=false;
  try {
    assert.match(schema,/^test_cpm_discovery_\d+$/);
    await admin.query("CREATE DATABASE "+quote(schema));created=true;
    pool=mysql.createPool({...opts,database:schema,connectionLimit:6,decimalNumbers:false});
    const ddl=[
      "CREATE TABLE users (id BIGINT PRIMARY KEY,ad_balance DECIMAL(20,8),balance_available DECIMAL(20,8),balance_locked DECIMAL(20,8)) ENGINE=InnoDB",
      "CREATE TABLE campaigns (id BIGINT PRIMARY KEY,user_id BIGINT,type VARCHAR(20),platform_revenue DECIMAL(20,8),reserve_amount DECIMAL(20,8)) ENGINE=InnoDB",
      "CREATE TABLE channels (id BIGINT PRIMARY KEY,user_id BIGINT) ENGINE=InnoDB",
      "CREATE TABLE campaign_posts (id BIGINT PRIMARY KEY,campaign_id BIGINT,channel_id BIGINT) ENGINE=InnoDB",
      "CREATE TABLE campaign_clicks (id BIGINT PRIMARY KEY,campaign_id BIGINT,post_id BIGINT,fingerprint VARCHAR(255),is_bot TINYINT,created_at TIMESTAMP) ENGINE=InnoDB",
      "CREATE TABLE channel_fraud_events (id BIGINT PRIMARY KEY,campaign_id BIGINT,channel_id BIGINT,post_id BIGINT,billing_state VARCHAR(30),false_positive_at DATETIME NULL) ENGINE=InnoDB",
      "CREATE TABLE channel_unified_settlement_events (id BIGINT AUTO_INCREMENT PRIMARY KEY,idempotency_key VARCHAR(191) UNIQUE,campaign_id BIGINT,advertiser_id BIGINT,publisher_id BIGINT,channel_id BIGINT,post_id BIGINT,units BIGINT,unit_price DECIMAL(20,8),advertiser_debit DECIMAL(20,8),publisher_credit DECIMAL(20,8),platform_revenue DECIMAL(20,8),reserve_contribution DECIMAL(20,8),settlement_type VARCHAR(32),status VARCHAR(32),created_at DATETIME(6)) ENGINE=InnoDB",
      "CREATE TABLE channel_advertiser_debits (source_key VARCHAR(191) PRIMARY KEY,settlement_type VARCHAR(20),publisher_status VARCHAR(20),publisher_settled_at DATETIME NULL,campaign_id BIGINT,post_id BIGINT,channel_id BIGINT,publisher_id BIGINT,advertiser_debit DECIMAL(20,8),publisher_credit DECIMAL(20,8),units BIGINT,unit_price DECIMAL(20,8)) ENGINE=InnoDB",
      "CREATE TABLE advertiser_direct_debits (source_key VARCHAR(255) PRIMARY KEY,status VARCHAR(20),campaign_table VARCHAR(32),billing_type VARCHAR(32),advertiser_id BIGINT,campaign_id BIGINT,amount DECIMAL(20,8)) ENGINE=InnoDB",
    ];
    for(const q of ddl)await pool.query(q);
    for(const file of ["db/migrations/20261102_1200_channel_cpm_pending.sql",
      "db/migrations/20261102_1210_cpm_window_finalization.sql",
      "db/migrations/20261102_1220_cpm_allocation_plan.sql"]) {
      const sql=fs.readFileSync(file,"utf8").split(/\r?\n/)
        .filter(line=>!line.trimStart().startsWith("--")).join("\n");
      for(const q of sql.split(";").map(x=>x.trim()).filter(Boolean))await pool.query(q);
    }
    await pool.query("INSERT INTO users VALUES (1,100,0,0),(2,0,5,0),(3,0,2,0)");
    await pool.query("INSERT INTO campaigns VALUES (10,1,'views',0,0),(11,1,'views',0,0),(12,1,'views',0,0),(13,1,'views',0,0),(14,1,'views',0,0)");
    await pool.query("INSERT INTO channels VALUES (20,2),(21,3)");
    await pool.query("INSERT INTO campaign_posts VALUES (103,10,20),(104,11,20),(106,10,20),(107,12,21),(108,13,20),(109,13,20),(110,14,21)");
    await pool.query("INSERT INTO channel_cpm_window_policies (campaign_id,window_seconds,grace_seconds) VALUES (10,3600,900),(11,3600,900),(12,3600,900),(13,1800,300),(14,3600,900)");
    const [[clock]]=await pool.query("SELECT UNIX_TIMESTAMP() AS n");const now=Number(clock.n);
    const rows=[
      [1,10,now+3600,now+7200,now+8100,"pending"],
      [2,10,now-3600,now-60,now+840,"pending"],
      [3,10,fixed,fixed+3600,fixed+4500,"pending"],
      [4,11,fixed,fixed+3600,fixed+4500,"pending"],
      [5,11,fixed+3600,fixed+7200,fixed+8100,"finalized"],
      [6,10,fixed+3600,fixed+7200,fixed+8100,"pending"],
      [7,12,fixed,fixed+3600,fixed+4500,"pending"],
      [8,13,fixed,fixed+1800,fixed+2100,"pending"],
      [9,13,fixed+3600,fixed+5400,fixed+6300,"pending"],
      [10,14,fixed,fixed+3600,fixed+4500,"pending"],
    ];
    for(const row of rows)await pool.query("INSERT INTO channel_cpm_settlement_windows (id,campaign_id,start_epoch,end_epoch,finalizable_epoch,status) VALUES (?,?,?,?,?,?)",row);
    async function funded(id,window,campaign,publisher,channel,post,epoch,withFunding=true) {
      const key="discovery-"+id;
      await pool.query("INSERT INTO channel_unified_settlement_events VALUES (?,?,?,?,?,?,?,100,'10.00000000','1.00000000','0.60000000','0.30000000','0.10000000','cpm_view','funded_pending',FROM_UNIXTIME(?))",
        [id,key,campaign,1,publisher,channel,post,epoch]);
      await pool.query("INSERT INTO channel_advertiser_debits VALUES (?,'view','window_pending',NULL,?,?,?,?,?,?,100,'10.00000000')",
        [key,campaign,post,channel,publisher,"1.00000000","0.60000000"]);
      if(withFunding)await pool.query("INSERT INTO advertiser_direct_debits VALUES (?,'settled','campaigns','channel_view',1,?,'1.00000000')",
        ["channel:"+key,campaign]);
      await pool.query("INSERT INTO channel_cpm_pending_allocations (window_id,campaign_id,advertiser_id,publisher_id,channel_id,post_id,canonical_event_id,source_key,billable_views,unit_price,advertiser_debit,neutral_entitlement,platform_revenue,reserve_contribution,event_epoch) VALUES (?,?,1,?,?,?,?,?,100,'10.00000000','1.00000000','0.60000000','0.30000000','0.10000000',?)",
        [window,campaign,publisher,channel,post,id,key,epoch]);
    }
    await funded(3,3,10,2,20,103,fixed+600);
    await funded(4,4,11,2,20,104,fixed+600);
    await funded(6,6,10,2,20,106,fixed+4200,false);
    await funded(7,7,12,3,21,107,fixed+600);
    await funded(8,8,13,2,20,108,fixed+600);
    await funded(9,9,13,2,20,109,fixed+4200);
    await funded(10,10,14,3,21,110,fixed+600);
    async function plan(campaign,window) {const conn=await pool.getConnection();try{await conn.beginTransaction();const p=await planner.prepareCpmWindowAllocationPlan(conn,campaign,window);await conn.commit();return p}catch(e){await conn.rollback();throw e}finally{conn.release()}}
    await plan(11,4);await plan(12,7);
    await pool.query("INSERT INTO channel_cpm_plan_late_events (window_id,source_key,reason) VALUES (7,'late-7','arrival_after_plan')");
    await t.test("collecting, grace and completed windows are excluded but inspectable",async()=>{
      assert.equal((await inspect(pool,10,1)).kind,"collecting");
      assert.equal((await inspect(pool,10,2)).kind,"verification_grace");
      assert.equal((await inspect(pool,11,5)).kind,"finalized");
      const page=await discover(pool,{limit:20});
      assert.ok(!page.items.some(x=>[1,2,5].includes(x.windowId)));
      assert.equal(await inspect(pool,10,999),null);
    });
    await t.test("ready plan and sealed credit windows are distinguished",async()=>{
      const a=await inspect(pool,10,3),b=await inspect(pool,11,4);
      assert.deepEqual([a.kind,a.nextOperation,b.kind,b.nextOperation],
        ["prepare_plan","prepare_plan","finalize_credit","finalize_credit"]);
      assert.deepEqual([a.campaignId,a.windowId,b.campaignId,b.windowId],[10,3,11,4]);
    });
    await t.test("missing funding and policy conflict have diagnostics",async()=>{
      assert.match((await inspect(pool,10,6)).reason,/missing_or_conflicting_funding/);
      assert.deepEqual([(await inspect(pool,13,9)).kind,(await inspect(pool,13,9)).reason],
        ["blocked","window_policy_conflict"]);
      await pool.query("UPDATE advertiser_direct_debits SET status='failed' WHERE source_key='channel:discovery-3'");
      assert.equal((await inspect(pool,10,3)).kind,"blocked");
      await pool.query("UPDATE advertiser_direct_debits SET status='settled' WHERE source_key='channel:discovery-3'");
      await pool.query("UPDATE channel_cpm_pending_allocations SET advertiser_id=999 WHERE source_key='discovery-3'");
      await pool.query("UPDATE channel_unified_settlement_events SET advertiser_id=999 WHERE id=3");
      await pool.query("UPDATE advertiser_direct_debits SET advertiser_id=999 WHERE source_key='channel:discovery-3'");
      assert.match((await inspect(pool,10,3)).reason,/source_attribution_conflict/);
      await pool.query("UPDATE channel_cpm_pending_allocations SET advertiser_id=1 WHERE source_key='discovery-3'");
      await pool.query("UPDATE channel_unified_settlement_events SET advertiser_id=1 WHERE id=3");
      await pool.query("UPDATE advertiser_direct_debits SET advertiser_id=1 WHERE source_key='channel:discovery-3'");
      assert.equal((await inspect(pool,10,3)).kind,"prepare_plan");
    });
    await t.test("late event requires review; neutral click fallback stays ready",async()=>{
      const late=await inspect(pool,12,7);assert.equal(late.kind,"late_event_review");
      assert.equal(late.lateEventCount,1);assert.equal(late.nextOperation,null);
      const neutral=await inspect(pool,13,8);assert.equal(neutral.kind,"prepare_plan");
      assert.equal(neutral.reason,null);
      const [[clickCount]]=await pool.query("SELECT COUNT(*) n FROM campaign_clicks");assert.equal(clickCount.n,0);
    });
    await t.test("sealed manifest changes block finalization discovery",async()=>{
      await pool.query("UPDATE channel_cpm_pending_allocations SET platform_revenue='0.29000000',reserve_contribution='0.11000000' WHERE source_key='discovery-4'");
      await pool.query("UPDATE channel_unified_settlement_events SET platform_revenue='0.29000000',reserve_contribution='0.11000000' WHERE id=4");
      assert.match((await inspect(pool,11,4)).reason,/plan_source_membership_conflict/);
      await pool.query("UPDATE channel_cpm_pending_allocations SET platform_revenue='0.30000000',reserve_contribution='0.10000000' WHERE source_key='discovery-4'");
      await pool.query("UPDATE channel_unified_settlement_events SET platform_revenue='0.30000000',reserve_contribution='0.10000000' WHERE id=4");
      assert.equal((await inspect(pool,11,4)).kind,"finalize_credit");
    });
    await t.test("custom policy, UTC bounds, and campaign isolation",async()=>{
      const custom=await inspect(pool,13,8);assert.equal(custom.endEpoch-custom.startEpoch,1800);
      assert.equal(custom.finalizableEpoch-custom.endEpoch,300);
      assert.equal((await inspect(pool,14,10)).kind,"prepare_plan");
      assert.equal(await inspect(pool,10,10),null);
      const scoped=await discover(pool,{campaignId:13,limit:20});
      assert.deepEqual(scoped.items.map(x=>x.windowId),[8,9]);
    });
    await t.test("deterministic keyset pages never duplicate or skip due windows",async()=>{
      const full=await discover(pool,{limit:20});
      const expected=full.items.map(x=>x.windowId);
      assert.deepEqual(expected,[8,3,4,7,10,9,6]);
      const seen=[];let cursor=null,pages=0;
      do {const page=await discover(pool,{limit:2,cursor});assert.ok(page.items.length<=2);
        seen.push(...page.items.map(x=>x.windowId));cursor=page.nextCursor;pages++;
      } while(cursor);
      assert.deepEqual(seen,expected);assert.ok(pages>=4);
      assert.equal(new Set(seen).size,seen.length);
      await assert.rejects(discover(pool,{limit:501}),/invalid_cpm_discovery_page/);
    });
    await t.test("simultaneous discovery is read-only and financially inert",async()=>{
      const [a,b]=await Promise.all([discover(pool,{limit:20}),discover(pool,{limit:20})]);
      assert.deepEqual(a.items,b.items);
      const [users]=await pool.query("SELECT ad_balance,balance_available,balance_locked FROM users ORDER BY id");
      assert.deepEqual(users.map(x=>[x.ad_balance,x.balance_available,x.balance_locked]),
        [["100.00000000","0.00000000","0.00000000"],["0.00000000","5.00000000","0.00000000"],["0.00000000","2.00000000","0.00000000"]]);
      const [campaigns]=await pool.query("SELECT platform_revenue,reserve_amount FROM campaigns ORDER BY id");
      assert.ok(campaigns.every(x=>x.platform_revenue==="0.00000000"&&x.reserve_amount==="0.00000000"));
      const [[payouts]]=await pool.query("SELECT COUNT(*) n FROM channel_cpm_window_payouts");assert.equal(payouts.n,0);
      const [[charges]]=await pool.query("SELECT COUNT(*) n FROM advertiser_direct_debits");assert.equal(charges.n,6);
    });
    await t.test("unresolved fraud blocks eligibility without changing records",async()=>{
      await pool.query("INSERT INTO channel_fraud_events VALUES (1,10,20,103,'confirmed_fraud',NULL)");
      const blocked=await inspect(pool,10,3);assert.equal(blocked.kind,"blocked");
      assert.match(blocked.reason,/unresolved_fraud/);
      await pool.query("DELETE FROM channel_fraud_events WHERE id=1");
      assert.equal((await inspect(pool,10,3)).kind,"prepare_plan");
    });
  } finally {
    if(pool)await pool.end();
    if(created)await admin.query("DROP DATABASE "+quote(schema));
    await admin.end();
  }
});
