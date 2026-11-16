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
const postingContext=load("src/lib/financialPostingContext.ts");
const earnings=load("src/lib/earnings.ts",{"./financialPostingContext":postingContext});
const finalizer=load("src/lib/channelCpmWindowCreditFinalizer.ts",{
  "@/lib/channelAllocationMath":math,
  "@/lib/channelCpmWindowAllocationPlan":planner,
  "@/lib/earnings":earnings,
});
const discovery=load("src/lib/channelCpmWindowDiscovery.ts",{
  "@/lib/channelAllocationMath":math,
});
const {processDueCpmWindows:runProcessor}=load("src/lib/channelCpmWindowProcessor.ts",{
  "@/lib/channelCpmWindowDiscovery":discovery,
  "@/lib/channelCpmWindowAllocationPlan":planner,
  "@/lib/channelCpmWindowCreditFinalizer":finalizer,
});
const opts={host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASS};
const schema="test_cpm_processor_"+Date.now(),quote=n=>"\u0060"+n+"\u0060";
const start=Date.parse("2026-01-01T10:00:00Z")/1000,end=start+3600;

test("disabled processor never opens a database connection",async()=>{
  const original=process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED;
  delete process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED;
  try {
    const result=await runProcessor({getConnection(){throw new Error("unexpected_database_access")}});
    assert.deepEqual([result.status,result.scanned,result.plansPrepared,result.creditsFinalized],
      ["disabled",0,0,0]);
  } finally {
    if(original===undefined)delete process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED;
    else process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED=original;
  }
});

test("disposable MariaDB CPM automatic processor",async t=>{
  const originalFlag=process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED;
  const admin=await mysql.createConnection({...opts,database:process.env.DB_NAME});
  let pool,created=false;
  try {
    assert.match(schema,/^test_cpm_processor_\d+$/);
    await admin.query("CREATE DATABASE "+quote(schema));created=true;
    pool=mysql.createPool({...opts,database:schema,connectionLimit:10,decimalNumbers:false});
    const ddl=[
      "CREATE TABLE users (id INT PRIMARY KEY,balance_available DECIMAL(20,8) NOT NULL DEFAULT 0,balance_locked DECIMAL(20,8) NOT NULL DEFAULT 0,ad_balance DECIMAL(20,8) NOT NULL DEFAULT 0) ENGINE=InnoDB",
      "CREATE TABLE campaigns (id BIGINT PRIMARY KEY,user_id BIGINT,type VARCHAR(20),platform_revenue DECIMAL(20,8) DEFAULT 0,reserve_amount DECIMAL(20,8) DEFAULT 0) ENGINE=InnoDB",
      "CREATE TABLE channels (id BIGINT PRIMARY KEY,user_id BIGINT) ENGINE=InnoDB",
      "CREATE TABLE campaign_posts (id BIGINT PRIMARY KEY,campaign_id BIGINT,channel_id BIGINT) ENGINE=InnoDB",
      "CREATE TABLE campaign_clicks (id BIGINT PRIMARY KEY,campaign_id BIGINT,post_id BIGINT,fingerprint VARCHAR(255),is_bot TINYINT,created_at TIMESTAMP) ENGINE=InnoDB",
      "CREATE TABLE channel_fraud_events (id BIGINT PRIMARY KEY,campaign_id BIGINT,channel_id BIGINT,post_id BIGINT,billing_state VARCHAR(30),false_positive_at DATETIME NULL) ENGINE=InnoDB",
      "CREATE TABLE channel_unified_settlement_events (id BIGINT AUTO_INCREMENT PRIMARY KEY,idempotency_key VARCHAR(191) UNIQUE,campaign_id BIGINT,advertiser_id BIGINT,publisher_id BIGINT,channel_id BIGINT,post_id BIGINT,units BIGINT,unit_price DECIMAL(20,8),advertiser_debit DECIMAL(20,8),publisher_credit DECIMAL(20,8),platform_revenue DECIMAL(20,8),reserve_contribution DECIMAL(20,8),settlement_type VARCHAR(32),status VARCHAR(32),created_at DATETIME(6)) ENGINE=InnoDB",
      "CREATE TABLE channel_advertiser_debits (source_key VARCHAR(191) PRIMARY KEY,settlement_type VARCHAR(20),publisher_status VARCHAR(20),publisher_settled_at DATETIME NULL,campaign_id BIGINT,post_id BIGINT,channel_id BIGINT,publisher_id BIGINT,advertiser_debit DECIMAL(20,8),publisher_credit DECIMAL(20,8),units BIGINT,unit_price DECIMAL(20,8)) ENGINE=InnoDB",
      "CREATE TABLE advertiser_direct_debits (source_key VARCHAR(255) PRIMARY KEY,status VARCHAR(20),campaign_table VARCHAR(32),billing_type VARCHAR(32),advertiser_id BIGINT,campaign_id BIGINT,amount DECIMAL(20,8)) ENGINE=InnoDB",
      "CREATE TABLE channel_reserve_treasury_ledger (id BIGINT PRIMARY KEY,amount DECIMAL(20,8)) ENGINE=InnoDB",
    ];
    for(const q of ddl)await pool.query(q);
    for(const file of ["db/migrations/20261101_0800_publisher_balance_events.sql",
      "db/migrations/20261102_1200_channel_cpm_pending.sql",
      "db/migrations/20261102_1210_cpm_window_finalization.sql",
      "db/migrations/20261102_1220_cpm_allocation_plan.sql"]) {
      const sql=fs.readFileSync(file,"utf8").split(/\r?\n/)
        .filter(line=>!line.trimStart().startsWith("--")).join("\n");
      for(const q of sql.split(";").map(x=>x.trim()).filter(Boolean))await pool.query(q);
    }
    await pool.query("INSERT INTO users (id,balance_available,ad_balance) VALUES (1,0,100),(2,5,0),(3,2,0),(4,0,0)");
    await pool.query("INSERT INTO channels VALUES (20,2),(21,3),(22,4)");
    await pool.query("INSERT INTO channel_reserve_treasury_ledger VALUES (1,1.00000000)");
    async function window(id,campaign,publisher,channel,post,options={}) {
      const epoch=options.startEpoch??start;
      const key="processor-"+id;
      await pool.query("INSERT INTO campaigns (id,user_id,type) VALUES (?,1,'views')",[campaign]);
      await pool.query("INSERT INTO campaign_posts VALUES (?,?,?)",[post,campaign,channel]);
      await pool.query("INSERT INTO channel_cpm_window_policies (campaign_id,window_seconds,grace_seconds) VALUES (?,3600,900)",[campaign]);
      await pool.query("INSERT INTO channel_cpm_settlement_windows (id,campaign_id,start_epoch,end_epoch,finalizable_epoch) VALUES (?,?,?,?,?)",
        [id,campaign,epoch,epoch+3600,epoch+4500]);
      await pool.query("INSERT INTO channel_unified_settlement_events VALUES (?,?,?,?,?,?,?,100,'10.00000000','1.00000000','0.60000000','0.30000000','0.10000000','cpm_view','funded_pending',FROM_UNIXTIME(?))",
        [id,key,campaign,1,publisher,channel,post,epoch+600]);
      await pool.query("INSERT INTO channel_advertiser_debits VALUES (?,'view','window_pending',NULL,?,?,?,?,?,?,100,'10.00000000')",
        [key,campaign,post,channel,publisher,"1.00000000","0.60000000"]);
      if(options.funded!==false)await pool.query("INSERT INTO advertiser_direct_debits VALUES (?,'settled','campaigns','channel_view',1,?,'1.00000000')",
        ["channel:"+key,campaign]);
      await pool.query("INSERT INTO channel_cpm_pending_allocations (window_id,campaign_id,advertiser_id,publisher_id,channel_id,post_id,canonical_event_id,source_key,billable_views,unit_price,advertiser_debit,neutral_entitlement,platform_revenue,reserve_contribution,event_epoch) VALUES (?,?,1,?,?,?,?,?,100,'10.00000000','1.00000000','0.60000000','0.30000000','0.10000000',?)",
        [id,campaign,publisher,channel,post,id,key,epoch+600]);
    }
    async function prepare(campaign,id){const conn=await pool.getConnection();try{await conn.beginTransaction();const value=await planner.prepareCpmWindowAllocationPlan(conn,campaign,id);await conn.commit();return value}catch(e){await conn.rollback();throw e}finally{conn.release()}}
    await window(1,10,2,20,101);
    await window(2,11,2,20,102);
    await window(3,12,3,21,103);
    await window(4,13,3,21,104);
    await window(5,14,2,20,105,{funded:false});
    await window(6,15,3,21,106);
    await prepare(12,3);await prepare(15,6);
    await pool.query("INSERT INTO channel_cpm_plan_late_events (window_id,source_key,reason) VALUES (6,'late-6','arrival_after_plan')");
    process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED="true";
    await t.test("one bounded run prepares a plan without paying; next run finalizes",async()=>{
      const [[fundingBefore]]=await pool.query("SELECT SUM(amount) charged FROM advertiser_direct_debits");
      const [[splitBefore]]=await pool.query("SELECT SUM(platform_revenue) platform,SUM(reserve_contribution) reserve FROM channel_unified_settlement_events");
      const [[treasuryBefore]]=await pool.query("SELECT amount FROM channel_reserve_treasury_ledger WHERE id=1");
      const first=await runProcessor(pool,{campaignId:10,maxWindows:1,pageSize:1});
      assert.deepEqual([first.status,first.scanned,first.plansPrepared,first.creditsFinalized],
        ["completed",1,1,0]);
      assert.equal(first.items[0].outcome,"plan_prepared");
      const [[userBefore]]=await pool.query("SELECT balance_available FROM users WHERE id=2");
      assert.equal(userBefore.balance_available,"5.00000000");
      const [[planned]]=await pool.query("SELECT status FROM channel_cpm_settlement_windows WHERE id=1");
      assert.equal(planned.status,"planned");
      const second=await runProcessor(pool,{campaignId:10,maxWindows:1,pageSize:1});
      assert.equal(second.items[0].outcome,"credit_finalized");
      assert.equal(second.items[0].credited,"0.60000000");
      const [[userAfter]]=await pool.query("SELECT balance_available FROM users WHERE id=2");
      assert.equal(userAfter.balance_available,"5.60000000");
      assert.equal((await runProcessor(pool,{campaignId:10,maxWindows:1})).scanned,0);
      const [[fundingAfter]]=await pool.query("SELECT SUM(amount) charged FROM advertiser_direct_debits");
      const [[splitAfter]]=await pool.query("SELECT SUM(platform_revenue) platform,SUM(reserve_contribution) reserve FROM channel_unified_settlement_events");
      const [[treasuryAfter]]=await pool.query("SELECT amount FROM channel_reserve_treasury_ledger WHERE id=1");
      assert.deepEqual(fundingAfter,fundingBefore);
      assert.deepEqual(splitAfter,splitBefore);
      assert.deepEqual(treasuryAfter,treasuryBefore);
    });
    await t.test("failed campaign does not stop independent plans or credits",async()=>{
      await pool.query("CREATE TRIGGER test_fail_plan BEFORE INSERT ON channel_cpm_allocation_plans FOR EACH ROW IF NEW.campaign_id=11 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected_plan_failure'; END IF");
      const run=await runProcessor(pool,{maxWindows:10,pageSize:2});
      assert.equal(run.status,"partial_failure");
      assert.deepEqual([run.plansPrepared,run.creditsFinalized,run.failures,run.blocked,run.lateReview],
        [1,1,1,1,1]);
      assert.equal(run.retryFailedFromStart,true);
      assert.equal(run.items.find(x=>x.windowId===2).outcome,"failed");
      assert.equal(run.items.find(x=>x.windowId===3).outcome,"credit_finalized");
      assert.equal(run.items.find(x=>x.windowId===4).outcome,"plan_prepared");
      assert.equal(run.items.find(x=>x.windowId===5).outcome,"blocked");
      assert.equal(run.items.find(x=>x.windowId===6).outcome,"late_event_review");
      const [[failedWindow]]=await pool.query("SELECT status FROM channel_cpm_settlement_windows WHERE id=2");
      assert.equal(failedWindow.status,"pending");
      await pool.query("DROP TRIGGER test_fail_plan");
    });
    await t.test("failed plan retries later; no in-run rediscovery loop",async()=>{
      const retry=await runProcessor(pool,{maxWindows:10,pageSize:1});
      assert.equal(retry.failures,0);
      assert.equal(retry.items.find(x=>x.windowId===2).outcome,"plan_prepared");
      assert.equal(retry.items.find(x=>x.windowId===4).outcome,"credit_finalized");
      assert.equal(retry.items.filter(x=>x.windowId===2).length,1);
      const finish=await runProcessor(pool,{campaignId:11,maxWindows:1});
      assert.equal(finish.items[0].outcome,"credit_finalized");
      assert.equal((await runProcessor(pool,{campaignId:11,maxWindows:1})).scanned,0);
    });
    await t.test("two workers share database idempotency for plan and credit",async()=>{
      await window(7,16,4,22,107);
      const first=await Promise.all([
        runProcessor(pool,{campaignId:16,maxWindows:1}),
        runProcessor(pool,{campaignId:16,maxWindows:1}),
      ]);
      const [[plans]]=await pool.query("SELECT COUNT(*) n FROM channel_cpm_allocation_plans WHERE window_id=7");
      assert.equal(plans.n,1);
      assert.ok(first.every(x=>x.failures===0));
      const second=await Promise.all([
        runProcessor(pool,{campaignId:16,maxWindows:1}),
        runProcessor(pool,{campaignId:16,maxWindows:1}),
      ]);
      assert.ok(second.every(x=>x.failures===0));
      const [[payouts]]=await pool.query("SELECT COUNT(*) n FROM channel_cpm_window_payouts WHERE window_id=7");
      assert.equal(payouts.n,1);
      const [[events]]=await pool.query("SELECT COUNT(*) n FROM publisher_balance_events WHERE source_event_key LIKE 'cpm-window:7:%'");
      assert.equal(events.n,1);
      const [[user]]=await pool.query("SELECT balance_available FROM users WHERE id=4");
      assert.equal(user.balance_available,"0.60000000");
    });
    await t.test("failed publisher-credit transaction rolls back and retries",async()=>{
      await window(8,17,4,22,108);
      await prepare(17,8);
      await pool.query("CREATE TRIGGER test_fail_credit BEFORE UPDATE ON users FOR EACH ROW IF NEW.id=4 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected_credit_failure'; END IF");
      const failed=await runProcessor(pool,{campaignId:17,maxWindows:1});
      assert.equal(failed.status,"partial_failure");
      assert.equal(failed.items[0].outcome,"failed");
      const [[before]]=await pool.query("SELECT COUNT(*) n FROM channel_cpm_window_payouts WHERE window_id=8");
      assert.equal(before.n,0);
      await pool.query("DROP TRIGGER test_fail_credit");
      const retry=await runProcessor(pool,{campaignId:17,maxWindows:1});
      assert.equal(retry.items[0].outcome,"credit_finalized");
      assert.equal((await runProcessor(pool,{campaignId:17,maxWindows:1})).scanned,0);
    });
    await t.test("bounded cursor pages continue without skips",async()=>{
      await window(9,18,2,20,109);
      // A second window for the same campaign uses the persisted one-hour policy.
      const epoch=start+3600,key="processor-10";
      await pool.query("INSERT INTO campaign_posts VALUES (110,18,20)");
      await pool.query("INSERT INTO channel_cpm_settlement_windows (id,campaign_id,start_epoch,end_epoch,finalizable_epoch) VALUES (10,18,?,?,?)",
        [epoch,epoch+3600,epoch+4500]);
      await pool.query("INSERT INTO channel_unified_settlement_events VALUES (10,?,18,1,2,20,110,100,'10.00000000','1.00000000','0.60000000','0.30000000','0.10000000','cpm_view','funded_pending',FROM_UNIXTIME(?))",
        [key,epoch+600]);
      await pool.query("INSERT INTO channel_advertiser_debits VALUES (?,'view','window_pending',NULL,18,110,20,2,'1.00000000','0.60000000',100,'10.00000000')",[key]);
      await pool.query("INSERT INTO advertiser_direct_debits VALUES (?,'settled','campaigns','channel_view',1,18,'1.00000000')",["channel:"+key]);
      await pool.query("INSERT INTO channel_cpm_pending_allocations (window_id,campaign_id,advertiser_id,publisher_id,channel_id,post_id,canonical_event_id,source_key,billable_views,unit_price,advertiser_debit,neutral_entitlement,platform_revenue,reserve_contribution,event_epoch) VALUES (10,18,1,2,20,110,10,?,100,'10.00000000','1.00000000','0.60000000','0.30000000','0.10000000',?)",[key,epoch+600]);
      const first=await runProcessor(pool,{campaignId:18,maxWindows:1,pageSize:1});
      assert.equal(first.items[0].windowId,9);
      assert.ok(first.nextCursor);
      const second=await runProcessor(pool,{campaignId:18,maxWindows:1,pageSize:1,cursor:first.nextCursor});
      assert.equal(second.items[0].windowId,10);
      assert.equal(second.nextCursor,null);
      const [plans]=await pool.query("SELECT window_id FROM channel_cpm_allocation_plans WHERE campaign_id=18 ORDER BY window_id");
      assert.deepEqual(plans.map(p=>p.window_id),[9,10]);
    });
    await t.test("UTC window across midnight waits for its own grace and credits once",async()=>{
      const overnight=Date.parse("2026-01-01T23:00:00Z")/1000;
      await window(11,19,2,20,111,{startEpoch:overnight});
      const [[w]]=await pool.query("SELECT start_epoch,end_epoch,finalizable_epoch FROM channel_cpm_settlement_windows WHERE id=11");
      assert.deepEqual([Number(w.start_epoch),Number(w.end_epoch),Number(w.finalizable_epoch)],
        [overnight,overnight+3600,overnight+4500]);
      const [[before]]=await pool.query("SELECT balance_available,balance_locked FROM users WHERE id=2");
      const prepared=await runProcessor(pool,{campaignId:19,maxWindows:1});
      assert.equal(prepared.items[0].outcome,"plan_prepared");
      const [[waiting]]=await pool.query("SELECT balance_available,balance_locked FROM users WHERE id=2");
      assert.deepEqual(waiting,before);
      const finalized=await runProcessor(pool,{campaignId:19,maxWindows:1});
      assert.equal(finalized.items[0].outcome,"credit_finalized");
      const [[after]]=await pool.query("SELECT balance_available,balance_locked FROM users WHERE id=2");
      assert.equal(math.decimalToUnits(after.balance_available)-math.decimalToUnits(before.balance_available),60000000n);
      assert.equal(after.balance_locked,before.balance_locked);
      assert.equal((await runProcessor(pool,{campaignId:19,maxWindows:1})).scanned,0);
    });
    await t.test("flag off remains fail-closed after work; money split unchanged",async()=>{
      delete process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED;
      const [[before]]=await pool.query("SELECT COUNT(*) n FROM channel_cpm_window_payouts");
      const off=await runProcessor(pool,{maxWindows:10});
      assert.equal(off.status,"disabled");
      const [[after]]=await pool.query("SELECT COUNT(*) n FROM channel_cpm_window_payouts");
      assert.equal(after.n,before.n);
      process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED="true";
      const [[charges]]=await pool.query("SELECT SUM(amount) total FROM advertiser_direct_debits");
      const [[platform]]=await pool.query("SELECT SUM(platform_revenue) total,SUM(reserve_contribution) reserve FROM channel_unified_settlement_events");
      const [[treasury]]=await pool.query("SELECT amount FROM channel_reserve_treasury_ledger WHERE id=1");
      assert.equal(treasury.amount,"1.00000000");
      const [campaigns]=await pool.query("SELECT platform_revenue,reserve_amount FROM campaigns");
      assert.ok(campaigns.every(c=>c.platform_revenue==="0.00000000"&&c.reserve_amount==="0.00000000"));
      assert.ok(math.decimalToUnits(charges.total)>0n);
      assert.ok(math.decimalToUnits(platform.total)>0n);
      assert.ok(math.decimalToUnits(platform.reserve)>0n);
    });
    await t.test("discovery errors are visible and options are bounded",async()=>{
      const broken={async getConnection(){throw new Error("injected_discovery_failure")}};
      const r=await runProcessor(broken,{maxWindows:1});
      assert.deepEqual([r.status,r.failures,r.retryFailedFromStart],["discovery_failed",1,true]);
      await assert.rejects(runProcessor(pool,{maxWindows:501}),/invalid_cpm_processor_options/);
    });
  } finally {
    if(originalFlag===undefined)delete process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED;
    else process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED=originalFlag;
    if(pool)await pool.end();
    if(created)await admin.query("DROP DATABASE "+quote(schema));
    await admin.end();
  }
});
