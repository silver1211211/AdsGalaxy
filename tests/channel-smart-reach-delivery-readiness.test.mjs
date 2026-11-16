import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import mysql from "mysql2/promise";
import ts from "typescript";

function load(path,deps={}){
  const js=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};
  new Function("module","exports","require","process",js)(mod,mod.exports,name=>{
    if(name in deps)return deps[name];throw new Error(`unexpected_dependency_${name}`);
  },process);
  return mod.exports;
}
const math=load("src/lib/channelAllocationMath.ts");
const charge=load("src/lib/channelSmartReachImpressionMath.ts",{"@/lib/channelAllocationMath":math});
const readiness=load("src/lib/channelSmartReachDeliveryReadiness.ts",{
  "@/lib/channelAllocationMath":math,
  "@/lib/channelSmartReachImpressionMath":charge,
  "@/lib/channelSmartReachConfiguration":{SMART_REACH_POLICY_VERSION:"adsgalaxy-smart-reach-v1"},
});
const env={CHANNEL_PHASE1_FINANCIAL_ENABLED:"true",CHANNEL_SMART_REACH_CONFIG_ENABLED:"true",
  CHANNEL_SMART_REACH_IMPRESSION_BILLING_ENABLED:"true",CHANNEL_SMART_REACH_CPC_CLICK_SETTLEMENT_ENABLED:"true",
  CHANNEL_SMART_REACH_RESERVE_FUNDING_ENABLED:"true",CHANNEL_SMART_REACH_DYNAMIC_CPM_ENABLED:"true",
  CHANNEL_SMART_REACH_COMPLETE_SETTLEMENT_READY:"true"};
const base={id:1,status:"paused",pause_reason:"smart_reach_billing_pending",approved_creative_revision_id:1,
  pending_creative_revision_id:null,rejection_reason:null,financial_policy_version:"adsgalaxy-smart-reach-v1",
  financial_billing_mode:"smart_reach",type:"clicks",campaign_kind:"channel",funding_model:"direct_debit",
  smart_reach_effective_cpm:"0.10000000",smart_reach_max_cpm:"0.50000000",budget:"1.00000000",
  daily_budget_limit:null,ad_balance:"1.00000000",resume_locked_until:null};
const check=(changes={},options={})=>readiness.evaluateSmartReachDeliveryReadiness({campaign:{...base,...changes},
  dailySpent:"0",schemaReady:true,env,...options});

test("complete Smart Reach settlement requires all explicit release gates",()=>{
  assert.equal(readiness.SMART_REACH_CPC_CLICK_SETTLEMENT_IMPLEMENTED,true);
  assert.equal(check().ready,true);
  assert.ok(check({}, {env:{...env,CHANNEL_SMART_REACH_CPC_CLICK_SETTLEMENT_ENABLED:"false"}}).reasons.includes("click_settlement_incomplete"));
  assert.ok(check({}, {env:{...env,CHANNEL_SMART_REACH_RESERVE_FUNDING_ENABLED:"false"}}).reasons.includes("smart_reach_backend_disabled"));
  assert.ok(check({}, {env:{...env,CHANNEL_SMART_REACH_COMPLETE_SETTLEMENT_READY:"false"}}).reasons.includes("complete_settlement_gate_disabled"));
  assert.ok(check({}, {env:{...env,CHANNEL_SMART_REACH_IMPRESSION_BILLING_ENABLED:"false"}}).reasons.includes("impression_billing_disabled"));
  assert.ok(check({}, {schemaReady:false}).reasons.includes("impression_billing_schema_unavailable"));
});
test("approval, wallet, remaining budget and daily cap are all required",()=>{
  assert.ok(check({ad_balance:"0"}).reasons.includes("advertiser_wallet_insufficient"));
  assert.ok(!check().reasons.includes("advertiser_wallet_insufficient"));
  assert.ok(check({approved_creative_revision_id:null}).reasons.includes("admin_approval_required"));
  assert.ok(check({budget:"0.00009999"}).reasons.includes("campaign_budget_insufficient"));
  assert.ok(check({daily_budget_limit:"0.01000000"},{dailySpent:"0.00999999"}).reasons.includes("daily_budget_insufficient"));
});
test("intentional manual pause and one-hour cooldown remain distinct from system funding pause",()=>{
  assert.ok(!check().reasons.includes("manual_pause_requires_explicit_resume"));
  const manual={pause_reason:"user_paused",resume_locked_until:new Date("2026-11-13T13:00:00Z")};
  const now=new Date("2026-11-13T12:30:00Z");
  assert.ok(check(manual,{now}).reasons.includes("manual_pause_requires_explicit_resume"));
  assert.ok(check(manual,{now,explicitManualResume:true}).reasons.includes("manual_pause_cooldown"));
  assert.ok(!check(manual,{now:new Date("2026-11-13T13:01:00Z"),explicitManualResume:true}).reasons.includes("manual_pause_cooldown"));
  assert.ok(check({status:"suspended",pause_reason:"moderation_cleanup"}).reasons.includes("campaign_restricted"));
});
test("legacy campaign policies cannot be mistaken for Smart Reach",()=>{
  assert.ok(check({financial_policy_version:null,financial_billing_mode:null}).reasons.includes("invalid_smart_reach_policy"));
  assert.ok(check({type:"views"}).reasons.includes("invalid_smart_reach_policy"));
  const advertiser=readFileSync("src/app/api/advertiser/campaigns/[id]/route.ts","utf8");
  const admin=readFileSync("src/lib/campaignActionsHandler.ts","utf8");
  assert.match(advertiser,/checkSmartReachDeliveryReadiness/);
  assert.match(admin,/checkSmartReachDeliveryReadiness/);
});
test("disposable MariaDB reader sees wallet and status changes without activating a campaign",async()=>{
  const schema=`test_smart_ready_${randomUUID().replaceAll("-","")}`;
  const server=await mysql.createConnection({host:"127.0.0.1",port:53307,user:"root"});
  let db;
  try{
    await server.query(`CREATE DATABASE \`${schema}\``);
    db=mysql.createPool({host:"127.0.0.1",port:53307,user:"root",database:schema});
    await db.query("CREATE TABLE users(id INT PRIMARY KEY,ad_balance DECIMAL(24,8))");
    await db.query(`CREATE TABLE campaigns(id INT PRIMARY KEY,user_id INT,status VARCHAR(30),pause_reason VARCHAR(60),
      approved_creative_revision_id INT,pending_creative_revision_id INT,rejection_reason VARCHAR(255),
      financial_policy_version VARCHAR(64),financial_billing_mode VARCHAR(32),type VARCHAR(20),
      campaign_kind VARCHAR(30),funding_model VARCHAR(30),smart_reach_effective_cpm DECIMAL(24,8),
      smart_reach_max_cpm DECIMAL(24,8),budget DECIMAL(24,8),daily_budget_limit DECIMAL(24,8),resume_locked_until DATETIME)`);
    for(const table of ["channel_smart_reach_impression_billings","channel_smart_reach_funding_allocations",
      "channel_smart_reach_view_claims","advertiser_direct_debits","publisher_balance_events",
      "channel_smart_reach_reserve_fundings","channel_smart_reach_reserve_allocations",
      "channel_smart_reach_cpm_evaluations","channel_unified_settlement_events",
      "channel_reserve_treasury_ledger"]){
      await db.query(`CREATE TABLE ${table}(id INT PRIMARY KEY${table==="channel_smart_reach_impression_billings"?",campaign_id INT,advertiser_charge DECIMAL(24,8),created_at DATETIME":""})`);
    }
    await db.query("INSERT INTO users VALUES(1,0)");
    await db.query(`INSERT INTO campaigns VALUES(1,1,'paused','smart_reach_billing_pending',1,NULL,NULL,
      'adsgalaxy-smart-reach-v1','smart_reach','clicks','channel','direct_debit',0.10000000,0.50000000,1,NULL,NULL)`);
    const original=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));
    try{
      Object.assign(process.env,env);
      const before=await readiness.checkSmartReachDeliveryReadiness(db,1);
      assert.ok(before.reasons.includes("advertiser_wallet_insufficient"));
      await Promise.all([db.query("UPDATE users SET ad_balance=1 WHERE id=1"),
        db.query("UPDATE campaigns SET pause_reason='user_paused' WHERE id=1")]);
      const after=await readiness.checkSmartReachDeliveryReadiness(db,1);
      assert.ok(!after.reasons.includes("advertiser_wallet_insufficient"));
      assert.ok(after.reasons.includes("manual_pause_requires_explicit_resume"));
      assert.ok(!after.reasons.includes("click_settlement_incomplete"));
      assert.equal((await db.query("SELECT status FROM campaigns WHERE id=1"))[0][0].status,"paused");
    }finally{for(const [key,value] of Object.entries(original)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
  }finally{if(db)await db.end();await server.query(`DROP DATABASE IF EXISTS \`${schema}\``);await server.end();}
});
