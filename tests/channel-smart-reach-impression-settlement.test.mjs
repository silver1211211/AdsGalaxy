import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import mysql from "mysql2/promise";
import ts from "typescript";

const schema=`test_smart_impression_${randomUUID().replaceAll("-","")}`;
const config={host:"127.0.0.1",port:53307,user:"root",multipleStatements:true};
function load(path,deps={}){
  const js=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};
  new Function("module","exports","require","process",js)(mod,mod.exports,name=>{
    if(name in deps)return deps[name];
    if(name==="server-only")return {};
    throw new Error(`unexpected_dependency_${name}`);
  },process);
  return mod.exports;
}
const math=load("src/lib/channelAllocationMath.ts");
const charge=load("src/lib/channelSmartReachImpressionMath.ts",{"@/lib/channelAllocationMath":math});
const posting=load("src/lib/financialPostingContext.ts");
const earnings=load("src/lib/earnings.ts",{"./financialPostingContext":posting});
const debit=load("src/lib/advertiserDirectDebit.ts",{"@/lib/platformNotifications":{recordBalanceNotificationTransition:async()=>{}}});
const views=load("src/lib/channelViewPersistence.ts",{"@/lib/channelViewPipeline":{}});
const viewRule=load("src/lib/channelTrustFraudStability.ts",{"./channelAllocationMath":math});
const waivers=load("src/lib/channelViewWaivers.ts",{"@/lib/db":{default:{}}});
const service=load("src/lib/channelSmartReachImpressionSettlement.ts",{
  "@/lib/channelAllocationMath":math,
  "@/lib/channelSmartReachImpressionMath":charge,
  "@/lib/channelSmartReachConfiguration":{SMART_REACH_POLICY_VERSION:"adsgalaxy-smart-reach-v1"},
  "@/lib/channelViewPersistence":views,
  "@/lib/advertiserDirectDebit":debit,
  "@/lib/earnings":earnings,
  "@/lib/channelViewWaivers":waivers,
  "@/lib/channelTrustFraudStability":viewRule,
});
const dispatcher=load("src/lib/channelVerifiedViewBillingDispatcher.ts",{
  "@/lib/channelSmartReachConfiguration":{SMART_REACH_POLICY_VERSION:"adsgalaxy-smart-reach-v1"},
  "@/lib/channelSmartReachImpressionSettlement":service,
  "@/lib/channelSmartReachReserveFunding":{fundPendingSmartReachClaimsFromReserve:async()=>({status:"disabled"})},
  "@/lib/channelSmartReachDynamicCpm":{evaluateSmartReachDynamicCpm:async()=>({status:"disabled"})},
  "@/lib/channelFastBilling":{debitConfirmedChannelViews:async()=>({debited:false,duplicate:false,units:0,campaignId:null})},
});
function migration(file){
  const result=spawnSync("/usr/bin/mariadb",["--no-defaults","-h","127.0.0.1","-P","53307","-u","root",schema],
    {input:readFileSync(file,"utf8"),encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);
}
async function rows(db,sql,args=[]){const [r]=await db.query(sql,args);return r;}
const flags={CHANNEL_PHASE1_FINANCIAL_ENABLED:"true",CHANNEL_SMART_REACH_CONFIG_ENABLED:"true",CHANNEL_SMART_REACH_IMPRESSION_BILLING_ENABLED:"true"};

test("isolated Smart Reach billing is atomic, funded and replay-safe",async()=>{
  const admin=await mysql.createConnection(config);
  let db;
  const original=Object.fromEntries(Object.keys(flags).map(key=>[key,process.env[key]]));
  try{
    await admin.query(`CREATE DATABASE \`${schema}\``);
    db=mysql.createPool({...config,database:schema,connectionLimit:8});
    await db.query(`CREATE TABLE users(id INT PRIMARY KEY,ad_balance DECIMAL(24,8) NOT NULL DEFAULT 0,
      balance_available DECIMAL(24,8) NOT NULL DEFAULT 0,balance_locked DECIMAL(24,8) NOT NULL DEFAULT 0,
      is_banned TINYINT NOT NULL DEFAULT 0)`);
    await db.query(`CREATE TABLE campaigns(id INT PRIMARY KEY,user_id INT NOT NULL,status VARCHAR(20),type VARCHAR(20),
      campaign_kind VARCHAR(30),funding_model VARCHAR(30),financial_policy_version VARCHAR(64),
      financial_billing_mode VARCHAR(32),smart_reach_effective_cpm DECIMAL(24,8),smart_reach_max_cpm DECIMAL(24,8),
      budget DECIMAL(24,8),spend DECIMAL(24,8) DEFAULT 0,daily_budget_limit DECIMAL(24,8))`);
    await db.query(`CREATE TABLE channels(id INT PRIMARY KEY,user_id INT,status VARCHAR(20),view_tracking_status VARCHAR(20),
      subscriber_count INT,under_review TINYINT DEFAULT 0,is_deleted TINYINT DEFAULT 0,
      revenue_protection_status VARCHAR(30),settlement_excluded_until DATETIME)`);
    await db.query(`CREATE TABLE campaign_posts(id INT PRIMARY KEY,campaign_id INT,channel_id INT,status VARCHAR(20),
      views INT,delivery_confirmed_at DATETIME,delivery_failed_at DATETIME,deleted_at DATETIME,
      view_fetch_status VARCHAR(20),view_fetch_source VARCHAR(50))`);
    await db.query(`CREATE TABLE campaign_views_audit(id BIGINT UNSIGNED PRIMARY KEY,post_id INT,channel_id INT,total_views INT,status VARCHAR(20))`);
    await db.query(`CREATE TABLE channel_fraud_events(id INT PRIMARY KEY,channel_id INT,post_id INT,campaign_id INT,
      billing_state VARCHAR(30),false_positive_at DATETIME)`);
    await db.query("CREATE TABLE channel_view_waivers(id INT PRIMARY KEY,post_id INT,waived_views INT)");
    await db.query(`CREATE TABLE advertiser_direct_debits(source_key VARCHAR(191) PRIMARY KEY,advertiser_id INT,campaign_id INT,
      campaign_table VARCHAR(40),billing_type VARCHAR(40),amount DECIMAL(24,8),status VARCHAR(20),settled_at DATETIME)`);
    await db.query(`CREATE TABLE advertiser_transactions(id INT AUTO_INCREMENT PRIMARY KEY,user_id INT,amount DECIMAL(24,8),
      type VARCHAR(20),description VARCHAR(255))`);
    migration("db/migrations/20261113_1700_smart_reach_impression_finance.sql");
    migration("db/migrations/20261113_1800_smart_reach_funding_allocations.sql");
    await db.query("INSERT INTO users(id,ad_balance) VALUES(1,1.00000000),(2,0.00000000),(3,0.00000000)");
    await db.query(`INSERT INTO campaigns VALUES(1,1,'active','clicks','channel','direct_debit',
      'adsgalaxy-smart-reach-v1','smart_reach',0.10000000,0.50000000,1.00000000,0,NULL)`);
    await db.query("INSERT INTO channels(id,user_id,status,view_tracking_status,subscriber_count) VALUES(1,2,'active','active',1000),(2,2,'active','active',1000),(3,3,'active','active',1000)");
    await db.query(`INSERT INTO campaign_posts VALUES(1,1,1,'active',1,NOW(),NULL,NULL,'success','public_api'),
      (2,1,2,'active',100,NOW(),NULL,NULL,'success','public_api'),
      (3,1,3,'active',100,NOW(),NULL,NULL,'success','public_api')`);
    await db.query("INSERT INTO campaign_views_audit VALUES(1,1,1,1,'valid'),(2,2,2,100,'valid'),(3,3,3,100,'valid')");
    Object.assign(process.env,flags);
    const first=await service.settleSmartReachImpressions(db,{campaignId:1,postId:1,publisherId:2,viewAuditId:1,idempotencyKey:"first"});
    assert.equal(first.chargeDecimal,"0.00010000");
    assert.equal(first.status,"settled");
    const replay=await service.settleSmartReachImpressions(db,{campaignId:1,postId:1,publisherId:2,viewAuditId:1,idempotencyKey:"first"});
    assert.equal(replay.status,"duplicate");
    await assert.rejects(service.settleSmartReachImpressions(db,{campaignId:1,postId:2,publisherId:2,viewAuditId:2,idempotencyKey:"first"}),/idempotency_conflict/);
    const second=await service.settleSmartReachImpressions(db,{campaignId:1,postId:2,publisherId:2,viewAuditId:2,idempotencyKey:"second"});
    assert.equal(second.chargeDecimal,"0.01000000");
    await service.settleSmartReachImpressions(db,{campaignId:1,postId:3,publisherId:3,viewAuditId:3,idempotencyKey:"third"});
    assert.equal((await rows(db,"SELECT ad_balance FROM users WHERE id=1"))[0].ad_balance,"0.97990000");
    const [billing]=await rows(db,"SELECT SUM(advertiser_charge) charge,SUM(publisher_funding) funded FROM channel_smart_reach_impression_billings");
    const [pools]=await rows(db,"SELECT SUM(publisher_pool_amount) amount FROM channel_smart_reach_impression_billings");
    const [alloc]=await rows(db,"SELECT SUM(amount) amount FROM channel_smart_reach_funding_allocations");
    const [accounts]=await rows(db,"SELECT SUM(funded_amount) funded,SUM(pending_amount) pending FROM channel_smart_reach_publisher_accounts");
    assert.equal(billing.charge,"0.02010000");
    assert.equal(pools.amount,billing.charge);
    assert.equal(billing.funded,alloc.amount);
    assert.equal(accounts.funded,alloc.amount);
    assert.equal((await rows(db,"SELECT SUM(balance_available) amount FROM users WHERE id IN (2,3)"))[0].amount,alloc.amount);
    assert.ok(Number(accounts.pending)>0);
    assert.equal((await rows(db,"SELECT COUNT(*) count FROM advertiser_direct_debits"))[0].count,3);
    assert.equal((await rows(db,"SELECT COUNT(*) count FROM channel_smart_reach_impression_billings"))[0].count,3);
    assert.ok((await rows(db,"SELECT COUNT(*) count FROM channel_smart_reach_funding_allocations WHERE billing_event_id=?",[second.billingEventId]))[0].count>=2);
    assert.ok((await rows(db,"SELECT COUNT(*) count FROM channel_smart_reach_funding_allocations WHERE claim_id=1"))[0].count>=2);
    await assert.rejects(service.settleSmartReachImpressions(db,{campaignId:1,postId:1,publisherId:2,viewAuditId:1,idempotencyKey:"other"}),/stale_or_invalid/);
    assert.equal((await rows(db,"SELECT COUNT(*) count FROM channel_smart_reach_impression_billings"))[0].count,3);
    await db.query(`INSERT INTO campaign_posts VALUES(4,1,2,'active',500,NOW(),NULL,NULL,'success','public_api'),
      (5,1,2,'active',1000,NOW(),NULL,NULL,'success','public_api')`);
    await db.query("INSERT INTO campaign_views_audit VALUES(4,4,2,500,'valid'),(5,5,2,1000,'valid')");
    assert.equal((await service.settleSmartReachImpressions(db,{campaignId:1,postId:4,publisherId:2,viewAuditId:4,idempotencyKey:"fivehundred"})).chargeDecimal,"0.05000000");
    assert.equal((await service.settleSmartReachImpressions(db,{campaignId:1,postId:5,publisherId:2,viewAuditId:5,idempotencyKey:"onethousand"})).chargeDecimal,"0.03990000");
    assert.equal((await rows(db,"SELECT billable_views,through_view_count FROM channel_smart_reach_impression_billings WHERE post_id=5"))[0].billable_views,399);
    assert.equal((await rows(db,"SELECT entitled_amount FROM channel_smart_reach_publisher_accounts WHERE campaign_id=1 AND publisher_id=2"))[0].entitled_amount,"0.10000000");
    await db.query("INSERT INTO campaign_posts VALUES(11,1,2,'active',500,NOW(),NULL,NULL,'success','public_api')");
    await db.query("INSERT INTO campaign_views_audit VALUES(11,11,2,500,'valid')");
    const cappedWallet=(await rows(db,"SELECT ad_balance FROM users WHERE id=1"))[0].ad_balance;
    const cappedEvents=(await rows(db,"SELECT COUNT(*) count FROM channel_smart_reach_impression_billings"))[0].count;
    assert.equal((await service.settleSmartReachImpressions(db,{campaignId:1,postId:11,publisherId:2,viewAuditId:11,idempotencyKey:"aftercap"})).status,"capped");
    assert.equal((await service.settleSmartReachImpressions(db,{campaignId:1,postId:11,publisherId:2,viewAuditId:11,idempotencyKey:"aftercap"})).status,"capped");
    assert.equal((await rows(db,"SELECT ad_balance FROM users WHERE id=1"))[0].ad_balance,cappedWallet);
    assert.equal((await rows(db,"SELECT COUNT(*) count FROM channel_smart_reach_impression_billings"))[0].count,cappedEvents);
    assert.equal((await rows(db,"SELECT observed_views FROM channel_smart_reach_view_claims WHERE post_id=11"))[0].observed_views,500);
    await db.query("INSERT INTO users(id) VALUES(4)");
    await db.query("INSERT INTO channels(id,user_id,status,view_tracking_status,subscriber_count) VALUES(4,4,'active','active',1000)");
    await db.query(`INSERT INTO campaigns VALUES(3,1,'active','clicks','channel','direct_debit',
      'adsgalaxy-smart-reach-v1','smart_reach',0.20000000,0.20000000,1.00000000,0,NULL)`);
    await db.query("INSERT INTO campaign_posts VALUES(12,3,4,'active',1000,NOW(),NULL,NULL,'success','public_api')");
    await db.query("INSERT INTO campaign_views_audit VALUES(12,12,4,1000,'valid')");
    assert.equal((await service.settleSmartReachImpressions(db,{campaignId:3,postId:12,publisherId:4,viewAuditId:12,idempotencyKey:"dynamic-rate"})).chargeDecimal,"0.10000000");
    const [higherRate]=await rows(db,`SELECT b.advertiser_charge,b.publisher_funding,
      b.publisher_pool_amount-b.publisher_funding unused,a.entitled_amount
      FROM channel_smart_reach_impression_billings b
      JOIN channel_smart_reach_publisher_accounts a ON a.campaign_id=b.campaign_id AND a.publisher_id=b.publisher_id
      WHERE b.post_id=12`);
    assert.deepEqual([higherRate.advertiser_charge,higherRate.publisher_funding,higherRate.unused,higherRate.entitled_amount],
      ["0.10000000","0.10000000","0.00000000","0.10000000"]);
    await db.query("INSERT INTO campaign_posts VALUES(13,3,4,'active',500,NOW(),NULL,NULL,'success','public_api')");
    await db.query("INSERT INTO campaign_views_audit VALUES(13,13,4,500,'valid')");
    const afterHigherRate=(await rows(db,"SELECT ad_balance FROM users WHERE id=1"))[0].ad_balance;
    assert.equal((await service.settleSmartReachImpressions(db,{campaignId:3,postId:13,publisherId:4,viewAuditId:13,idempotencyKey:"dynamic-aftercap"})).status,"capped");
    assert.equal((await rows(db,"SELECT ad_balance FROM users WHERE id=1"))[0].ad_balance,afterHigherRate);
    await db.query("INSERT INTO users(id) VALUES(5)");
    await db.query("INSERT INTO channels(id,user_id,status,view_tracking_status,subscriber_count) VALUES(5,5,'active','active',1000)");
    await db.query(`INSERT INTO campaigns VALUES(4,1,'active','clicks','channel','direct_debit',
      'adsgalaxy-smart-reach-v1','smart_reach',0.50000000,0.50000000,1.00000000,0,NULL)`);
    await db.query("INSERT INTO campaign_posts VALUES(14,4,5,'active',1000,NOW(),NULL,NULL,'success','public_api')");
    await db.query("INSERT INTO campaign_views_audit VALUES(14,14,5,1000,'valid')");
    assert.equal((await service.settleSmartReachImpressions(db,{campaignId:4,postId:14,publisherId:5,viewAuditId:14,idempotencyKey:"max-rate"})).chargeDecimal,"0.10000000");
    assert.equal((await rows(db,"SELECT publisher_pool_amount-publisher_funding unused FROM channel_smart_reach_impression_billings WHERE post_id=14"))[0].unused,"0.00000000");
    await db.query("CREATE TABLE channel_smart_reach_reserve_allocations(claim_id BIGINT UNSIGNED,amount DECIMAL(24,8))");
    await db.query("INSERT INTO users(id,balance_available) VALUES(6,0.05000000)");
    await db.query("INSERT INTO channels(id,user_id,status,view_tracking_status,subscriber_count) VALUES(6,6,'active','active',1000)");
    await db.query(`INSERT INTO campaigns VALUES(5,1,'active','clicks','channel','direct_debit',
      'adsgalaxy-smart-reach-v1','smart_reach',0.20000000,0.20000000,1.00000000,0,NULL)`);
    await db.query("INSERT INTO campaign_posts VALUES(15,5,6,'active',500,NOW(),NULL,NULL,'success','public_api'),(16,5,6,'active',500,NOW(),NULL,NULL,'success','public_api')");
    await db.query("INSERT INTO campaign_views_audit VALUES(16,16,6,500,'valid')");
    await db.query(`INSERT INTO channel_smart_reach_publisher_accounts
      (campaign_id,publisher_id,entitled_amount,funded_amount,pending_amount)
      VALUES(5,6,0.08000000,0.05000000,0.03000000)`);
    const [priorReserveClaim]=await db.query(`INSERT INTO channel_smart_reach_view_claims
      (campaign_id,publisher_id,post_id,channel_id,observed_views,entitled_amount,funded_amount,pending_amount)
      VALUES(5,6,15,6,500,0.08000000,0.05000000,0.03000000)`);
    await db.query("INSERT INTO channel_smart_reach_reserve_allocations VALUES(?,0.05000000)",[priorReserveClaim.insertId]);
    assert.equal((await service.settleSmartReachImpressions(db,{campaignId:5,postId:16,publisherId:6,viewAuditId:16,idempotencyKey:"reserve-prior"})).chargeDecimal,"0.05000000");
    const [reservePriorAccount]=await rows(db,"SELECT entitled_amount,funded_amount,pending_amount FROM channel_smart_reach_publisher_accounts WHERE campaign_id=5 AND publisher_id=6");
    assert.deepEqual([reservePriorAccount.entitled_amount,reservePriorAccount.funded_amount,reservePriorAccount.pending_amount],
      ["0.10000000","0.10000000","0.00000000"]);
    await db.query("INSERT INTO users(id) VALUES(7)");
    await db.query("INSERT INTO channels(id,user_id,status,view_tracking_status,subscriber_count) VALUES(7,7,'active','active',1000)");
    await db.query(`INSERT INTO campaigns VALUES(6,1,'active','clicks','channel','direct_debit',
      'adsgalaxy-smart-reach-v1','smart_reach',0.20000000,0.20000000,1.00000000,0,NULL)`);
    await db.query("INSERT INTO campaign_posts VALUES(17,6,7,'active',500,NOW(),NULL,NULL,'success','public_api'),(18,6,7,'active',500,NOW(),NULL,NULL,'success','public_api')");
    await db.query("INSERT INTO campaign_views_audit VALUES(17,17,7,500,'valid'),(18,18,7,500,'valid')");
    await db.query(`INSERT INTO channel_smart_reach_publisher_accounts
      (campaign_id,publisher_id,entitled_amount,pending_amount) VALUES(6,7,0.08000000,0.08000000)`);
    const [oldPoolClaim]=await db.query(`INSERT INTO channel_smart_reach_view_claims
      (campaign_id,publisher_id,post_id,channel_id,observed_views,entitled_amount,pending_amount)
      VALUES(6,7,17,7,500,0.08000000,0.08000000)`);
    await db.query(`INSERT INTO channel_smart_reach_impression_billings
      (idempotency_key,campaign_id,publisher_id,post_id,channel_id,advertiser_id,claim_id,view_audit_id,
       from_view_count,through_view_count,billable_views,effective_cpm,advertiser_charge,publisher_pool_amount,wallet_debit_source_key)
      VALUES('old-pool',6,7,17,7,1,?,17,0,500,500,0.20000000,0.10000000,0.10000000,'old-pool-debit')`,
      [oldPoolClaim.insertId]);
    const noCharge=await service.settleSmartReachImpressions(db,{campaignId:6,postId:18,publisherId:7,viewAuditId:18,idempotencyKey:"use-old-pool"});
    assert.equal(noCharge.status,"no_charge");
    assert.equal(noCharge.chargeDecimal,"0.00000000");
    assert.equal(noCharge.creditedDecimal,"0.10000000");
    assert.equal((await rows(db,"SELECT publisher_pool_amount-publisher_funding unused FROM channel_smart_reach_impression_billings WHERE campaign_id=6"))[0].unused,"0.00000000");
    const [oldPoolAccount]=await rows(db,"SELECT entitled_amount,funded_amount,pending_amount FROM channel_smart_reach_publisher_accounts WHERE campaign_id=6 AND publisher_id=7");
    assert.deepEqual([oldPoolAccount.entitled_amount,oldPoolAccount.funded_amount,oldPoolAccount.pending_amount],
      ["0.10000000","0.10000000","0.00000000"]);
    assert.equal((await service.settleSmartReachImpressions(db,{campaignId:6,postId:18,publisherId:7,viewAuditId:18,idempotencyKey:"use-old-pool"})).status,"capped");
    await db.query("INSERT INTO campaign_posts VALUES(6,1,3,'active',500,NOW(),NULL,NULL,'success','public_api')");
    await db.query("INSERT INTO campaign_views_audit VALUES(6,6,3,500,'valid')");
    await db.query("UPDATE users SET ad_balance=0.04999999 WHERE id=1");
    const beforeFail=(await rows(db,"SELECT COUNT(*) count FROM channel_smart_reach_impression_billings"))[0].count;
    await assert.rejects(service.settleSmartReachImpressions(db,{campaignId:1,postId:6,publisherId:3,viewAuditId:6,idempotencyKey:"insufficient"}),/wallet_insufficient/);
    assert.equal((await rows(db,"SELECT COUNT(*) count FROM channel_smart_reach_impression_billings"))[0].count,beforeFail);
    await db.query("UPDATE users SET ad_balance=0.05000000 WHERE id=1");
    assert.equal((await service.settleSmartReachImpressions(db,{campaignId:1,postId:6,publisherId:3,viewAuditId:6,idempotencyKey:"exact"})).chargeDecimal,"0.05000000");
    assert.equal((await rows(db,"SELECT ad_balance FROM users WHERE id=1"))[0].ad_balance,"0.00000000");
    await db.query("UPDATE users SET ad_balance=1.00000000 WHERE id=1");
    await db.query("INSERT INTO campaign_posts VALUES(7,1,3,'active',100,NOW(),NULL,NULL,'success','public_api')");
    await db.query("INSERT INTO campaign_views_audit VALUES(7,7,3,100,'valid')");
    await db.query(`CREATE TRIGGER fail_smart_publisher_credit BEFORE UPDATE ON users FOR EACH ROW
      IF NEW.id=3 AND NEW.balance_available<>OLD.balance_available THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced_publisher_credit_failure'; END IF`);
    const beforeRollback=(await rows(db,"SELECT COUNT(*) count FROM channel_smart_reach_impression_billings"))[0].count;
    const allocationsBeforeRollback=(await rows(db,"SELECT COUNT(*) count FROM channel_smart_reach_funding_allocations"))[0].count;
    await assert.rejects(service.settleSmartReachImpressions(db,{campaignId:1,postId:7,publisherId:3,viewAuditId:7,idempotencyKey:"rollback"}),/forced_publisher_credit_failure/);
    assert.equal((await rows(db,"SELECT ad_balance FROM users WHERE id=1"))[0].ad_balance,"1.00000000");
    assert.equal((await rows(db,"SELECT COUNT(*) count FROM channel_smart_reach_impression_billings"))[0].count,beforeRollback);
    assert.equal((await rows(db,"SELECT COUNT(*) count FROM channel_smart_reach_funding_allocations"))[0].count,allocationsBeforeRollback);
    await db.query("DROP TRIGGER fail_smart_publisher_credit");
    assert.equal((await dispatcher.retryLatestUnsettledSmartReachAudit(db,7,100)).status,"settled");
    assert.equal((await dispatcher.retryLatestUnsettledSmartReachAudit(db,7,100)).status,"duplicate");
    await db.query("INSERT INTO campaign_posts VALUES(8,1,3,'active',100,NOW(),NULL,NULL,'success','public_api')");
    await db.query("INSERT INTO campaign_views_audit VALUES(8,8,3,100,'valid')");
    const concurrent=await Promise.all([1,2].map(()=>service.settleSmartReachImpressions(db,
      {campaignId:1,postId:8,publisherId:3,viewAuditId:8,idempotencyKey:"concurrent"})));
    assert.deepEqual(concurrent.map(r=>r.status).sort(),["duplicate","settled"]);
    delete process.env.CHANNEL_SMART_REACH_IMPRESSION_BILLING_ENABLED;
    assert.equal((await service.settleSmartReachImpressions(db,{campaignId:1,postId:8,publisherId:3,viewAuditId:8,idempotencyKey:"disabled"})).status,"disabled");
    process.env.CHANNEL_SMART_REACH_IMPRESSION_BILLING_ENABLED="true";
    await db.query(`INSERT INTO campaigns VALUES(2,1,'active','clicks','channel','direct_debit',
      NULL,NULL,NULL,NULL,1.00000000,0,NULL)`);
    await assert.rejects(service.settleSmartReachImpressions(db,{campaignId:2,postId:8,publisherId:3,viewAuditId:8,idempotencyKey:"legacy"}),/policy_mismatch/);
    await db.query("UPDATE campaign_views_audit SET status='invalid' WHERE id=7");
    await assert.rejects(service.settleSmartReachImpressions(db,{campaignId:1,postId:7,publisherId:3,viewAuditId:7,idempotencyKey:"invalid_audit"}),/audit_mismatch/);
    await db.query("INSERT INTO campaign_posts VALUES(9,1,3,'active',100,NOW(),NULL,NULL,'success','public_api')");
    await db.query("INSERT INTO campaign_views_audit VALUES(9,9,3,100,'valid')");
    await db.query("UPDATE campaigns SET status='paused' WHERE id=1");
    const pausedCount=(await rows(db,"SELECT COUNT(*) count FROM channel_smart_reach_impression_billings"))[0].count;
    assert.equal((await dispatcher.dispatchVerifiedChannelViewBilling(db,{postId:9,viewAuditId:9,confirmedViews:100})).status,"paused");
    assert.equal((await rows(db,"SELECT COUNT(*) count FROM channel_smart_reach_impression_billings"))[0].count,pausedCount);
    await db.query("UPDATE campaigns SET status='active' WHERE id=1");
    assert.equal((await dispatcher.dispatchVerifiedChannelViewBilling(db,{postId:9,viewAuditId:9,confirmedViews:100})).status,"settled");
    assert.equal((await dispatcher.dispatchVerifiedChannelViewBilling(db,{postId:9,viewAuditId:9,confirmedViews:100})).status,"duplicate");
    assert.equal((await dispatcher.retryLatestUnsettledSmartReachAudit(db,9,100)).status,"duplicate");
    await assert.rejects(dispatcher.dispatchVerifiedChannelViewBilling(db,{postId:8,viewAuditId:null,confirmedViews:100}),/audit_required/);
    await assert.rejects(dispatcher.dispatchVerifiedChannelViewBilling(db,{postId:8,viewAuditId:8,confirmedViews:100}),/stale_or_invalid/);
    delete process.env.CHANNEL_SMART_REACH_IMPRESSION_BILLING_ENABLED;
    assert.equal((await dispatcher.dispatchVerifiedChannelViewBilling(db,{postId:9,viewAuditId:9,confirmedViews:100})).status,"disabled");
    process.env.CHANNEL_SMART_REACH_IMPRESSION_BILLING_ENABLED="true";
    await db.query("INSERT INTO campaign_posts VALUES(10,2,3,'active',100,NOW(),NULL,NULL,'success','public_api')");
    assert.equal((await dispatcher.dispatchVerifiedChannelViewBilling(db,{postId:10,viewAuditId:null,confirmedViews:100})).debited,false);
  }finally{
    for(const [key,value] of Object.entries(original)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    if(db)await db.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await admin.end();
  }
});
