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
const context=load("src/lib/financialPostingContext.ts");
const earnings=load("src/lib/earnings.ts",{"./financialPostingContext":context});
const {finalizeCpmWindowPublisherCredits:finalize}=load("src/lib/channelCpmWindowCreditFinalizer.ts",{
  "@/lib/channelAllocationMath":math,
  "@/lib/channelCpmWindowAllocationPlan":planner,
  "@/lib/earnings":earnings,
});
const opts={host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
  user:process.env.DB_USER,password:process.env.DB_PASS};
const schema="test_cpm_finalizer_"+Date.now();
const quote=name=>"\u0060"+name+"\u0060";
const start=Date.parse("2026-01-01T10:00:00Z")/1000,end=start+3600;

test("disposable MariaDB exactly-once CPM publisher finalizer",async t=>{
  const admin=await mysql.createConnection({...opts,database:process.env.DB_NAME});
  let pool,created=false;
  try {
    assert.match(schema,/^test_cpm_finalizer_\d+$/);
    await admin.query("CREATE DATABASE "+quote(schema));created=true;
    pool=mysql.createPool({...opts,database:schema,connectionLimit:8,decimalNumbers:false});
    const ddl=[
      "CREATE TABLE users (id INT PRIMARY KEY,balance_available DECIMAL(20,8) NOT NULL DEFAULT 0,balance_locked DECIMAL(20,8) NOT NULL DEFAULT 0,ad_balance DECIMAL(20,8) NOT NULL DEFAULT 0) ENGINE=InnoDB",
      "CREATE TABLE campaigns (id BIGINT PRIMARY KEY,user_id BIGINT,type VARCHAR(20),channel_platform_revenue DECIMAL(20,8) DEFAULT 0,channel_reserve_amount DECIMAL(20,8) DEFAULT 0) ENGINE=InnoDB",
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
      const text=fs.readFileSync(file,"utf8").split(/\r?\n/)
        .filter(line=>!line.trimStart().startsWith("--")).join("\n");
      for(const q of text.split(";").map(x=>x.trim()).filter(Boolean))await pool.query(q);
    }
    await pool.query("INSERT INTO users (id,balance_available,ad_balance) VALUES (1,0,100),(2,5,0),(3,2,0)");
    await pool.query("INSERT INTO campaigns (id,user_id,type) VALUES (10,1,'views'),(11,1,'views'),(12,1,'views')");
    await pool.query("INSERT INTO channels VALUES (20,2),(21,3)");
    await pool.query("INSERT INTO campaign_posts VALUES (100,10,20),(101,11,20),(102,11,21)");
    await pool.query("INSERT INTO channel_reserve_treasury_ledger VALUES (1,1.00000000)");
    await pool.query("INSERT INTO channel_cpm_window_policies (campaign_id,window_seconds,grace_seconds) VALUES (10,3600,900),(11,3600,900),(12,3600,900)");
    await pool.query("INSERT INTO channel_cpm_settlement_windows (id,campaign_id,start_epoch,end_epoch,finalizable_epoch,status) VALUES (1,10,?,?,?,'pending'),(2,11,?,?,?,'pending'),(3,12,?,?,?,'planned')",
      [start,end,end+900,start,end,end+900,start,end,end+900]);
    async function funded(id,key,campaign,publisher,channel,post,debit,neutral,platform,reserve) {
      await pool.query("INSERT INTO channel_unified_settlement_events VALUES (?,?,?,?,?,?,?,100,'100.00000000',?,?,?,?,'cpm_view','funded_pending','2026-01-01 10:10:00')",
        [id,key,campaign,1,publisher,channel,post,debit,neutral,platform,reserve]);
      await pool.query("INSERT INTO channel_advertiser_debits VALUES (?,'view','window_pending',NULL,?,?,?,?,?,?,100,'100.00000000')",
        [key,campaign,post,channel,publisher,debit,neutral]);
      await pool.query("INSERT INTO advertiser_direct_debits VALUES (?,'settled','campaigns','channel_view',1,?,?)",
        ["channel:"+key,campaign,debit]);
      await pool.query("INSERT INTO channel_cpm_pending_allocations (window_id,campaign_id,advertiser_id,publisher_id,channel_id,post_id,canonical_event_id,source_key,billable_views,unit_price,advertiser_debit,neutral_entitlement,platform_revenue,reserve_contribution,event_epoch) VALUES (?,?,1,?,?,?,?,?,100,'100.00000000',?,?,?,?,?)",
        [campaign===10?1:2,campaign,publisher,channel,post,id,key,debit,neutral,platform,reserve,start+600]);
    }
    await funded(1,"single",10,2,20,100,"10.00000000","6.00000000","3.00000000","1.00000000");
    await funded(2,"multi-a",11,2,20,101,"4.00000001","2.40000001","1.20000000","0.40000000");
    await funded(3,"multi-b",11,3,21,102,"6.00000000","3.60000000","1.80000000","0.60000000");
    async function transaction(fn){const conn=await pool.getConnection();try{await conn.beginTransaction();const value=await fn(conn);await conn.commit();return value}catch(e){await conn.rollback();throw e}finally{conn.release()}}
    const singlePlan=await transaction(c=>planner.prepareCpmWindowAllocationPlan(c,10,1));
    const multiPlan=await transaction(c=>planner.prepareCpmWindowAllocationPlan(c,11,2));
    assert.equal(singlePlan.manifest.publisherPool,"6.00000000");
    assert.equal(multiPlan.manifest.publisherPool,"6.00000001");
    assert.ok(multiPlan.manifest.publishers.every(p=>p.verifiedClicks===0 && !p.engagementTrusted));
    await t.test("grace and missing plan fail closed",async()=>{
      await pool.query("UPDATE channel_cpm_settlement_windows SET finalizable_epoch=UNIX_TIMESTAMP()+100 WHERE id=1");
      await assert.rejects(finalize(pool,10,1),/grace_not_elapsed/);
      await pool.query("UPDATE channel_cpm_settlement_windows SET finalizable_epoch=? WHERE id=1",[end+900]);
      await assert.rejects(finalize(pool,12,3),/plan_window_not_pending|missing_or_corrupt_sealed_plan|funding_conflict/);
      const [[count]]=await pool.query("SELECT COUNT(*) n FROM channel_cpm_window_payouts");assert.equal(count.n,0);
    });
    await t.test("funding or source corruption blocks a sealed plan",async()=>{
      await pool.query("UPDATE advertiser_direct_debits SET status='failed' WHERE source_key='channel:single'");
      await assert.rejects(finalize(pool,10,1),/funding_conflict|unfunded/);
      await pool.query("UPDATE advertiser_direct_debits SET status='settled' WHERE source_key='channel:single'");
      await pool.query("UPDATE channel_cpm_pending_allocations SET neutral_entitlement=5 WHERE source_key='single'");
      await assert.rejects(finalize(pool,10,1),/funding_conflict|late_or_changed_source|unfunded/);
      await pool.query("UPDATE channel_cpm_pending_allocations SET neutral_entitlement=6 WHERE source_key='single'");
      const [[count]]=await pool.query("SELECT COUNT(*) n FROM channel_cpm_window_payouts");assert.equal(count.n,0);
    });
    await t.test("one publisher is credited once from the saved neutral plan",async()=>{
      const result=await finalize(pool,10,1);
      assert.deepEqual([result.publisherCount,result.credited,result.duplicate],[1,"6.00000000",false]);
      const [[user]]=await pool.query("SELECT balance_available,balance_locked FROM users WHERE id=2");
      assert.deepEqual([user.balance_available,user.balance_locked],["11.00000000","0.00000000"]);
      const [[event]]=await pool.query("SELECT source_system,delta_available,delta_locked FROM publisher_balance_events WHERE source_event_key LIKE 'cpm-window:1:%'");
      assert.deepEqual([event.source_system,event.delta_available,event.delta_locked],["channel_cpm_window","6.00000000","0.00000000"]);
      const [[states]]=await pool.query("SELECT p.status pending,d.publisher_status debit,e.status event FROM channel_cpm_pending_allocations p JOIN channel_advertiser_debits d ON d.source_key=p.source_key JOIN channel_unified_settlement_events e ON e.id=p.canonical_event_id WHERE p.window_id=1");
      assert.deepEqual([states.pending,states.debit,states.event],["fulfilled","settled","settled"]);
      assert.equal((await finalize(pool,10,1)).duplicate,true);
      const [[count]]=await pool.query("SELECT COUNT(*) n FROM publisher_balance_events WHERE source_event_key LIKE 'cpm-window:1:%'");assert.equal(count.n,1);
    });
    await t.test("failed publisher credit rolls back prior publisher and payout",async()=>{
      await pool.query("CREATE TRIGGER test_fail_publisher BEFORE UPDATE ON users FOR EACH ROW IF NEW.id=3 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected_publisher_failure'; END IF");
      await assert.rejects(finalize(pool,11,2),/injected_publisher_failure/);
      await pool.query("DROP TRIGGER test_fail_publisher");
      const [users]=await pool.query("SELECT id,balance_available FROM users WHERE id IN (2,3) ORDER BY id");
      assert.deepEqual(users.map(x=>x.balance_available),["11.00000000","2.00000000"]);
      const [[count]]=await pool.query("SELECT COUNT(*) n FROM channel_cpm_window_payouts WHERE window_id=2");assert.equal(count.n,0);
      const [[window]]=await pool.query("SELECT status FROM channel_cpm_settlement_windows WHERE id=2");assert.equal(window.status,"planned");
    });
    await t.test("simulated interruption before commit rolls back and retry is safe",async()=>{
      const interrupted={async getConnection(){const conn=await pool.getConnection();return new Proxy(conn,{get(target,key){
        if(key==="query")return async (sql,...params)=>{
          if(String(sql).includes("SET status='finalized'"))throw new Error("simulated_interruption");
          return target.query(sql,...params);
        };
        const value=target[key];return typeof value==="function"?value.bind(target):value;
      }});}};
      await assert.rejects(finalize(interrupted,11,2),/simulated_interruption/);
      const [[count]]=await pool.query("SELECT COUNT(*) n FROM channel_cpm_window_payouts WHERE window_id=2");assert.equal(count.n,0);
      const [[eventCount]]=await pool.query("SELECT COUNT(*) n FROM publisher_balance_events WHERE source_event_key LIKE 'cpm-window:2:%'");assert.equal(eventCount.n,0);
    });
    await t.test("two workers finalize the multi-publisher pool exactly once",async()=>{
      const results=await Promise.all([finalize(pool,11,2),finalize(pool,11,2)]);
      assert.deepEqual(results.map(r=>r.duplicate).sort(),[false,true]);
      assert.ok(results.every(r=>r.credited==="6.00000001" && r.publisherCount===2));
      const [payouts]=await pool.query("SELECT publisher_id,final_amount,status FROM channel_cpm_window_payouts WHERE window_id=2 ORDER BY publisher_id");
      assert.deepEqual(payouts.map(p=>[p.publisher_id,p.final_amount,p.status]),
        [[2,"2.40000001","settled"],[3,"3.60000000","settled"]]);
      const [events]=await pool.query("SELECT user_id,delta_available,delta_locked FROM publisher_balance_events WHERE source_event_key LIKE 'cpm-window:2:%' ORDER BY user_id");
      assert.deepEqual(events.map(e=>[e.user_id,e.delta_available,e.delta_locked]),
        [[2,"2.40000001","0.00000000"],[3,"3.60000000","0.00000000"]]);
      const [users]=await pool.query("SELECT id,balance_available,balance_locked FROM users WHERE id IN (2,3) ORDER BY id");
      assert.deepEqual(users.map(u=>[u.balance_available,u.balance_locked]),
        [["13.40000001","0.00000000"],["5.60000000","0.00000000"]]);
    });
    await t.test("legacy queue exclusion, split, historical and campaign isolation",async()=>{
      const [[legacy]]=await pool.query("SELECT COUNT(*) n FROM channel_advertiser_debits WHERE publisher_status='pending' AND source_key IN ('single','multi-a','multi-b')");assert.equal(legacy.n,0);
      const [[funding]]=await pool.query("SELECT SUM(amount) total,COUNT(*) n FROM advertiser_direct_debits WHERE source_key IN ('channel:single','channel:multi-a','channel:multi-b')");
      assert.deepEqual([funding.total,funding.n],["20.00000001",3]);
      const [[split]]=await pool.query("SELECT SUM(advertiser_debit) debit,SUM(publisher_credit) neutral,SUM(platform_revenue) platform,SUM(reserve_contribution) reserve FROM channel_unified_settlement_events WHERE id IN (1,2,3)");
      assert.deepEqual([split.debit,split.neutral,split.platform,split.reserve],
        ["20.00000001","12.00000001","6.00000000","2.00000000"]);
      const [[treasury]]=await pool.query("SELECT amount FROM channel_reserve_treasury_ledger WHERE id=1");assert.equal(treasury.amount,"1.00000000");
      const [campaigns]=await pool.query("SELECT channel_platform_revenue,channel_reserve_amount FROM campaigns ORDER BY id");
      assert.ok(campaigns.every(c=>c.channel_platform_revenue==="0.00000000"&&c.channel_reserve_amount==="0.00000000"));
      const [[historical]]=await pool.query("SELECT available_after FROM publisher_balance_events WHERE source_event_key='account_opened:2'");
      assert.equal(historical.available_after,"5.00000000");
      const [[other]]=await pool.query("SELECT status FROM channel_cpm_settlement_windows WHERE id=3");assert.equal(other.status,"planned");
      assert.equal((await finalize(pool,10,1)).duplicate,true);
    });
    await t.test("corrupt saved plan is rejected even after finalization",async()=>{
      await pool.query("DROP TRIGGER trg_cpm_plan_no_update");
      await pool.query("UPDATE channel_cpm_allocation_plans SET publisher_pool='7.00000000' WHERE id=?",[singlePlan.planId]);
      await assert.rejects(finalize(pool,10,1),/publisher_pool_conflict/);
      await pool.query("UPDATE channel_cpm_allocation_plans SET publisher_pool='6.00000000' WHERE id=?",[singlePlan.planId]);
      assert.equal((await finalize(pool,10,1)).duplicate,true);
    });
  } finally {
    if(pool)await pool.end();
    if(created)await admin.query("DROP DATABASE "+quote(schema));
    await admin.end();
  }
});
