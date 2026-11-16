import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import mysql from "mysql2/promise";
import ts from "typescript";

const schema=`test_smart_click_${randomUUID().replaceAll("-","")}`;
const config={host:"127.0.0.1",port:53307,user:"root"};
function load(path,deps={}){
  const js=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};
  new Function("module","exports","require","process",js)(mod,mod.exports,name=>deps[name]??{},process);
  return mod.exports;
}
const math=load("src/lib/channelAllocationMath.ts");
const policy=load("src/lib/channelPhase1FinancialPolicy.ts",{"@/lib/channelAllocationMath":math});
const flags={CHANNEL_V101_UNIFIED_SETTLEMENT_ENABLED:"true",CHANNEL_PHASE1_FINANCIAL_ENABLED:"true",
  CHANNEL_SMART_REACH_CONFIG_ENABLED:"true",CHANNEL_SMART_REACH_IMPRESSION_BILLING_ENABLED:"true",
  CHANNEL_SMART_REACH_CPC_CLICK_SETTLEMENT_ENABLED:"true"};
let failShadow=false;
const service=load("src/lib/channelUnifiedSettlement.ts",{
  "@/lib/channelAllocationMath":math,
  "@/lib/channelPhase1FinancialPolicy":policy,
  "@/lib/channelSmartReachConfiguration":{SMART_REACH_POLICY_VERSION:"adsgalaxy-smart-reach-v1"},
  "@/lib/campaignCreativeRevision":{isBillablePublishedPlacement:({campaignStatus,placementStatus,deliveryConfirmed})=>
    campaignStatus==="active"&&placementStatus==="active"&&deliveryConfirmed},
  "@/lib/channelAcceptedEngagement":{hasAcceptedPreCutoffClick:async()=>false},
  "@/lib/channelDailySpend":{getChannelDailySpend:async()=>"0"},
  "@/lib/advertiserDirectDebit":{claimAdvertiserDirectDebit:async(conn,input)=>{
    const [update]=await conn.query("UPDATE users SET ad_balance=ad_balance-? WHERE id=? AND ad_balance>=?",
      [input.amount,input.advertiserId,input.amount]);
    if(!update.affectedRows)return {ok:false};
    await conn.query("INSERT INTO advertiser_direct_debits(source_key,campaign_id,amount) VALUES(?,?,?)",
      [input.sourceKey,input.campaignId,input.amount]);
    return {ok:true};
  }},
  "@/lib/earnings":{creditSettledPublisherBalance:async(conn,publisherId,amount,source)=>{
    await conn.query("UPDATE users SET balance_available=balance_available+? WHERE id=?",[amount,publisherId]);
    await conn.query("INSERT INTO publisher_balance_events(source_key,publisher_id,amount) VALUES(?,?,?)",
      [source.sourceKey,publisherId,amount]);
    return true;
  }},
  "@/lib/channelAllocationLedger":{shadowWriteChannelAllocation:async(conn,input)=>{
    if(failShadow)throw new Error("simulated_allocation_failure");
    await conn.query("INSERT INTO channel_allocation_ledger(source_key,amount) VALUES(?,?)",
      [input.sourceKey,input.advertiserDebit]);
  }},
});
async function one(db,sql,args=[]){const [rows]=await db.query(sql,args);return rows[0];}
async function tx(pool,fn){const conn=await pool.getConnection();try{await conn.beginTransaction();const value=await fn(conn);await conn.commit();return value}
  catch(error){await conn.rollback();throw error}finally{conn.release()}}
const click=(id,price="0.065")=>({campaignId:1,postId:1,channelId:1,publisherId:2,advertiserId:1,
  clickId:id,clickUnitPrice:price});

test("Smart Reach canonical CPC clicks are isolated, atomic and replay safe",async t=>{
  const admin=await mysql.createConnection(config);let db;
  const before=Object.fromEntries(Object.keys(flags).map(k=>[k,process.env[k]]));
  try{
    await admin.query(`CREATE DATABASE \`${schema}\``);
    db=mysql.createPool({...config,database:schema,connectionLimit:8});
    await db.query("CREATE TABLE users(id INT PRIMARY KEY,ad_balance DECIMAL(24,8),balance_available DECIMAL(24,8)) ENGINE=InnoDB");
    await db.query(`CREATE TABLE campaigns(id INT PRIMARY KEY,user_id INT,status VARCHAR(30),pause_reason VARCHAR(50),
      status_before_creative_review VARCHAR(30),approved_creative_revision_id INT,pending_creative_revision_id INT,
      budget DECIMAL(24,8),spend DECIMAL(24,8),funding_model VARCHAR(40),financial_policy_version VARCHAR(80),
      financial_billing_mode VARCHAR(40),cpc DECIMAL(24,8),type VARCHAR(30),campaign_kind VARCHAR(30),
      daily_budget_limit DECIMAL(24,8)) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE campaign_posts(id INT PRIMARY KEY,campaign_id INT,status VARCHAR(30),
      delivery_confirmed_at DATETIME,deleted_at DATETIME,settled_clicks INT DEFAULT 0,spend DECIMAL(24,8) DEFAULT 0) ENGINE=InnoDB`);
    await db.query("CREATE TABLE campaign_clicks(id INT PRIMARY KEY,post_id INT,campaign_id INT,is_bot TINYINT,accepted_at DATETIME(6)) ENGINE=InnoDB");
    await db.query("CREATE TABLE advertiser_rate_discounts(user_id INT PRIMARY KEY,cpc_discount DECIMAL(24,8),expires_at DATETIME) ENGINE=InnoDB");
    await db.query("CREATE TABLE channel_allocation_ledger(source_key VARCHAR(191) PRIMARY KEY,amount DECIMAL(24,8)) ENGINE=InnoDB");
    await db.query(`CREATE TABLE channel_reserve_treasury_ledger(id INT AUTO_INCREMENT PRIMARY KEY,
      idempotency_key VARCHAR(191) UNIQUE,entry_type VARCHAR(40),direction VARCHAR(8),amount DECIMAL(24,8),
      campaign_id INT,post_id INT,publisher_id INT,policy_version VARCHAR(80)) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE channel_cpc_reserve_advances(id INT PRIMARY KEY,campaign_id INT,publisher_id INT,
      unfunded_queue_amount DECIMAL(24,8),post_id INT,channel_id INT) ENGINE=InnoDB`);
    await db.query("CREATE TABLE channel_arr_transitions(id INT PRIMARY KEY) ENGINE=InnoDB");
    await db.query("CREATE TABLE channel_cpc_reserve_advance_posts(id INT PRIMARY KEY) ENGINE=InnoDB");
    await db.query("CREATE TABLE channel_reserve_treasury_control(id INT PRIMARY KEY) ENGINE=InnoDB");
    await db.query(`CREATE TABLE channel_unified_settlement_events(id INT AUTO_INCREMENT PRIMARY KEY,idempotency_key VARCHAR(191) UNIQUE,
      settlement_type VARCHAR(30),campaign_id INT,post_id INT,channel_id INT,publisher_id INT,advertiser_id INT,
      units INT,unit_price DECIMAL(24,8),advertiser_debit DECIMAL(24,8),publisher_credit DECIMAL(24,8),
      platform_revenue DECIMAL(24,8),reserve_contribution DECIMAL(24,8),arr_recovered DECIMAL(24,8),status VARCHAR(30)) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE channel_advertiser_debits(id INT AUTO_INCREMENT PRIMARY KEY,source_key VARCHAR(191) UNIQUE,
      settlement_type VARCHAR(20),campaign_id INT,post_id INT,channel_id INT,publisher_id INT,units INT,
      unit_price DECIMAL(24,8),advertiser_debit DECIMAL(24,8),platform_margin_percent DECIMAL(24,8),
      safety_reserve_percent DECIMAL(24,8),allocation_policy_version VARCHAR(80),publisher_status VARCHAR(30),
      publisher_credit DECIMAL(24,8),publisher_settled_at DATETIME) ENGINE=InnoDB`);
    await db.query("CREATE TABLE advertiser_direct_debits(source_key VARCHAR(191) PRIMARY KEY,campaign_id INT,amount DECIMAL(24,8)) ENGINE=InnoDB");
    await db.query("CREATE TABLE publisher_balance_events(source_key VARCHAR(191) PRIMARY KEY,publisher_id INT,amount DECIMAL(24,8)) ENGINE=InnoDB");
    await db.query("INSERT INTO users VALUES(1,1.00000000,0),(2,0,0)");
    await db.query(`INSERT INTO campaigns VALUES(1,1,'active',NULL,NULL,1,NULL,1.00000000,0,'direct_debit',
      'adsgalaxy-smart-reach-v1','smart_reach',65.00000000,'clicks','channel',NULL)`);
    await db.query("INSERT INTO campaign_posts(id,campaign_id,status,delivery_confirmed_at) VALUES(1,1,'active',NOW())");
    await db.query("INSERT INTO campaign_clicks VALUES(1,1,1,0,NOW(6)),(2,1,1,0,NOW(6)),(3,1,1,0,NOW(6)),(4,1,1,0,NOW(6)),(5,1,1,0,NULL),(6,1,1,1,NOW(6))");
    Object.assign(process.env,flags);
    await t.test("exact 60/30/10 charge and reserve attribution",async()=>{
      const result=await tx(db,c=>service.settleCanonicalCpcClick(c,click(1)));
      assert.equal(result.status,"settled");assert.equal(result.advertiserDebitDecimal,"0.06500000");
      assert.equal(result.publisherCreditDecimal,"0.03900000");assert.equal(result.platformRevenueDecimal,"0.01950000");
      assert.equal(result.reserveAllocationDecimal,"0.00650000");assert.equal(result.arrRecoveredDecimal,"0.00000000");
      assert.equal((await one(db,"SELECT ad_balance FROM users WHERE id=1")).ad_balance,"0.93500000");
      assert.equal((await one(db,"SELECT balance_available FROM users WHERE id=2")).balance_available,"0.03900000");
      const reserve=await one(db,"SELECT amount,campaign_id,policy_version FROM channel_reserve_treasury_ledger");
      assert.equal(reserve.amount,"0.00650000");assert.equal(reserve.campaign_id,1);
      assert.equal(reserve.policy_version,"adsgalaxy-smart-reach-v1");
    });
    await t.test("duplicate and concurrent click attempts charge only once",async()=>{
      assert.equal((await tx(db,c=>service.settleCanonicalCpcClick(c,click(1)))).status,"duplicate");
      const results=await Promise.all([tx(db,c=>service.settleCanonicalCpcClick(c,click(2))),
        tx(db,c=>service.settleCanonicalCpcClick(c,click(2)))]);
      assert.deepEqual(results.map(r=>r.status).sort(),["duplicate","settled"]);
      assert.equal((await one(db,"SELECT COUNT(*) n FROM channel_unified_settlement_events")).n,2);
    });
    await t.test("unaccepted evidence and wrong bid fail closed",async()=>{
      await assert.rejects(tx(db,c=>service.settleCanonicalCpcClick(c,click(6))),/unverified_click/);
      await assert.rejects(tx(db,c=>service.settleCanonicalCpcClick(c,click(5))),/not_accepted/);
      await assert.rejects(tx(db,c=>service.settleCanonicalCpcClick(c,click(3,"0.066"))),/bid_mismatch/);
      assert.equal((await one(db,"SELECT COUNT(*) n FROM channel_unified_settlement_events")).n,2);
    });
    await t.test("insufficient wallet and campaign budget leave no partial posting",async()=>{
      await db.query("UPDATE users SET ad_balance=0 WHERE id=1");
      await assert.rejects(tx(db,c=>service.settleCanonicalCpcClick(c,click(3))),/balance_insufficient/);
      await db.query("UPDATE users SET ad_balance=1 WHERE id=1");
      await db.query("UPDATE campaigns SET budget=0 WHERE id=1");
      assert.equal((await tx(db,c=>service.settleCanonicalCpcClick(c,click(3)))).status,"budget_exhausted");
      await db.query("UPDATE campaigns SET budget=1 WHERE id=1");
      assert.equal((await one(db,"SELECT COUNT(*) n FROM channel_unified_settlement_events")).n,2);
    });
    await t.test("failure after wallet debit rolls back debit, credit and reserve",async()=>{
      const wallet=(await one(db,"SELECT ad_balance FROM users WHERE id=1")).ad_balance;
      failShadow=true;
      await assert.rejects(tx(db,c=>service.settleCanonicalCpcClick(c,click(3))),/simulated_allocation_failure/);
      failShadow=false;
      assert.equal((await one(db,"SELECT ad_balance FROM users WHERE id=1")).ad_balance,wallet);
      assert.equal((await one(db,"SELECT COUNT(*) n FROM channel_reserve_treasury_ledger")).n,2);
      assert.equal((await one(db,"SELECT COUNT(*) n FROM channel_unified_settlement_events")).n,2);
    });
    await t.test("no allowance, ARR or impression posting; disabled flag blocks new click",async()=>{
      assert.equal((await one(db,"SELECT COUNT(*) n FROM channel_cpc_reserve_advances")).n,0);
      assert.equal((await one(db,"SELECT COUNT(*) n FROM channel_arr_transitions")).n,0);
      assert.equal((await one(db,"SELECT COUNT(*) n FROM channel_advertiser_debits")).n,2);
      delete process.env.CHANNEL_SMART_REACH_CPC_CLICK_SETTLEMENT_ENABLED;
      await assert.rejects(tx(db,c=>service.settleCanonicalCpcClick(c,click(4))),/disabled/);
    });
  }finally{
    for(const [key,value] of Object.entries(before))value===undefined?delete process.env[key]:process.env[key]=value;
    if(db)await db.end();await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);await admin.end();
  }
});
