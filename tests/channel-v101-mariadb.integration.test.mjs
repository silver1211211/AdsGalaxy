import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config({ path: ".env", quiet: true });

const existingTestSchema = process.env.CHANNEL_V101_TEST_SCHEMA === "adsfusion_teaser_test_20260910";
const schema = existingTestSchema ? "adsfusion_teaser_test_20260910" : "test_channel_v101_codex_" + Date.now();
const quote = (name) => String.fromCharCode(96) + name + String.fromCharCode(96);
const root = process.cwd();
const cache = new Map();
let testDb;

function load(file) {
  if (cache.has(file)) return cache.get(file);
  const source = fs.readFileSync(file, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const mod = { exports: {} };
  function customRequire(name) {
    if (name.includes("channelBilling")) return load("src/lib/channelBilling.ts");
    if (name.includes("campaignCreativeRevision")) return load("src/lib/campaignCreativeRevision.ts");
    if (name.includes("channelAcceptedEngagement")) return load("src/lib/channelAcceptedEngagement.ts");
    if (name.includes("dbResilience")) return { withFinancialTransactionRetry: async (fn) => {
      for(let attempt=0;attempt<3;attempt++){
        const conn=await testDb.getConnection();
        try { await conn.beginTransaction();const result=await fn(conn);await conn.commit();return result; }
        catch(error){await conn.rollback();if(attempt===2 || error.code!=="ER_LOCK_DEADLOCK") throw error;}
        finally {conn.release()}
      }
    } };
    if (name.includes("schemaGuards")) return { ensureClassicSettlementColumns: async () => {} };
    if (name.includes("campaignPostDeletion")) return { deleteExhaustedChannelCampaignPosts: async () => null };
    if (name.includes("campaignLifecycle")) return { markCampaignBudgetExhausted: async () => null };
    if (name.includes("channelDailyCap")) return { cleanupChannelDailyCapPosts: async () => null, markChannelDailyCapReached: async () => null };
    if (name.includes("channelFastBilling")) return load("src/lib/channelFastBilling.ts");
    if (name.includes("channelCpmPendingSettlement")) return load("src/lib/channelCpmPendingSettlement.ts");
    if (name.includes("channelUnifiedSettlement")) return load("src/lib/channelUnifiedSettlement.ts");
    if (name.includes("channelCpcZeroClickEligibility")) return load("src/lib/channelCpcZeroClickEligibility.ts");
    if (name.includes("channelViewPersistence")) return load("src/lib/channelViewPersistence.ts");
    if (name.includes("channelViewPipeline")) return load("src/lib/channelViewPipeline.ts");
    if (name.includes("channelAllocationMath")) return load("src/lib/channelAllocationMath.ts");
    if (name.includes("channelTrustFraudStability")) return load("src/lib/channelTrustFraudStability.ts");
    if (name.includes("channelReserveTreasury")) return load("src/lib/channelReserveTreasury.ts");
    if (name.includes("channelViewWaivers")) return load("src/lib/channelViewWaivers.ts");
    if (name.includes("channelDailySpend")) return { getChannelDailySpend: async (conn, campaignId) => {
      const [[row]] = await conn.query("SELECT COALESCE(SUM(advertiser_debit),0) spend FROM channel_advertiser_debits WHERE campaign_id=?", [campaignId]);
      return Number(row.spend);
    } };
    if (name.includes("advertiserDirectDebit")) return load("src/lib/advertiserDirectDebit.ts");
    if (name.includes("platformNotifications")) return { recordBalanceNotificationTransition: async () => {} };
    if (name.includes("channelAllocationLedger")) return { shadowWriteChannelAllocation: async () => ({ status: "written" }) };
    if (name.includes("financialPostingContext")) return load("src/lib/financialPostingContext.ts");
    if (name.includes("earnings")) return load("src/lib/earnings.ts");
    if (name.includes("db")) return { default: testDb };
    if (name === "server-only") return {};
    return {};
  }
  new Function("module","exports","require","process",output)(mod,mod.exports,customRequire,process);
  cache.set(file,mod.exports);
  return mod.exports;
}
const sql = [
  "CREATE TABLE users (id BIGINT PRIMARY KEY, ad_balance DECIMAL(20,8) NOT NULL, balance_available DECIMAL(20,8) NOT NULL DEFAULT 0, balance_locked DECIMAL(20,8) NOT NULL)",
  "CREATE TABLE campaigns (id BIGINT PRIMARY KEY,status VARCHAR(32),budget DECIMAL(20,8),spend DECIMAL(20,8),funding_model VARCHAR(32),daily_budget_limit DECIMAL(20,8))",
  "CREATE TABLE campaign_posts (id BIGINT PRIMARY KEY,campaign_id BIGINT,views BIGINT,settled_views BIGINT,settled_clicks BIGINT,spend DECIMAL(20,8))",
  "CREATE TABLE campaign_clicks (id BIGINT PRIMARY KEY,campaign_id BIGINT,post_id BIGINT,is_bot TINYINT)",
  "CREATE TABLE channel_view_waivers (post_id BIGINT,waived_views BIGINT)",
  "CREATE TABLE advertiser_direct_debits (source_key VARCHAR(255) PRIMARY KEY,advertiser_id BIGINT,campaign_id BIGINT,campaign_table VARCHAR(64),billing_type VARCHAR(64),amount DECIMAL(20,8),status VARCHAR(32),settled_at DATETIME NULL)",
  "CREATE TABLE advertiser_transactions (id BIGINT AUTO_INCREMENT PRIMARY KEY,user_id BIGINT,amount DECIMAL(20,8),type VARCHAR(32),description TEXT)",
  "CREATE TABLE channel_allocation_ledger (id BIGINT PRIMARY KEY)",
  "CREATE TABLE channel_reserve_treasury_control (id BIGINT PRIMARY KEY)",
  "CREATE TABLE channel_reserve_treasury_ledger (id BIGINT AUTO_INCREMENT PRIMARY KEY,idempotency_key VARCHAR(255) UNIQUE,entry_type VARCHAR(64),direction VARCHAR(8),amount DECIMAL(20,8),campaign_id BIGINT,post_id BIGINT,publisher_id BIGINT,policy_version VARCHAR(100),funding_authorization_ref VARCHAR(255))",
  "CREATE TABLE channel_cpc_reserve_advances (id BIGINT AUTO_INCREMENT PRIMARY KEY,campaign_id BIGINT,publisher_id BIGINT,post_id BIGINT,channel_id BIGINT,entitled_views BIGINT,entitled_amount DECIMAL(20,8),advanced_amount DECIMAL(20,8),recovered_amount DECIMAL(20,8) DEFAULT 0,unfunded_queue_amount DECIMAL(20,8),status VARCHAR(40),policy_version VARCHAR(100),created_at DATETIME DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uq_campaign_pub(campaign_id,publisher_id))",
  "CREATE TABLE channel_cpc_reserve_advance_posts (id BIGINT AUTO_INCREMENT PRIMARY KEY,advance_id BIGINT,campaign_id BIGINT,post_id BIGINT UNIQUE,channel_id BIGINT,publisher_id BIGINT,eligible_views BIGINT,allocated_advance DECIMAL(20,8),updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
  "CREATE TABLE channel_arr_transitions (id BIGINT AUTO_INCREMENT PRIMARY KEY,idempotency_key VARCHAR(255) UNIQUE,advance_id BIGINT,campaign_id BIGINT,post_id BIGINT,publisher_id BIGINT,click_id BIGINT,gross_click_unit_price DECIMAL(20,8),recovered_to_reserve DECIMAL(20,8),cash_paid_to_publisher DECIMAL(20,8),outstanding_advance_after DECIMAL(20,8),cumulative_publisher_earnings DECIMAL(20,8))",
  "CREATE TABLE channel_unified_settlement_events (id BIGINT AUTO_INCREMENT PRIMARY KEY,idempotency_key VARCHAR(255) UNIQUE,settlement_type VARCHAR(64),campaign_id BIGINT,post_id BIGINT,channel_id BIGINT,publisher_id BIGINT,advertiser_id BIGINT,units BIGINT,unit_price DECIMAL(20,8),advertiser_debit DECIMAL(20,8),publisher_credit DECIMAL(20,8),platform_revenue DECIMAL(20,8),reserve_contribution DECIMAL(20,8),arr_recovered DECIMAL(20,8),status VARCHAR(32),created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
  "CREATE TABLE channel_advertiser_debits (id BIGINT AUTO_INCREMENT PRIMARY KEY,source_key VARCHAR(255) UNIQUE,settlement_type VARCHAR(16),campaign_id BIGINT,post_id BIGINT,channel_id BIGINT,publisher_id BIGINT,units BIGINT,unit_price DECIMAL(20,8),advertiser_debit DECIMAL(20,8),platform_margin_percent DECIMAL(12,8),safety_reserve_percent DECIMAL(12,8),allocation_policy_version VARCHAR(100),publisher_status VARCHAR(32),publisher_credit DECIMAL(20,8),publisher_settled_at DATETIME,created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
];

test("isolated MariaDB canonical CPC advance, ARR, wallet debit and CPM delta", async () => {
  const opts={host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASS};
  const admin=await mysql.createConnection({...opts,database:process.env.DB_NAME});
  assert.ok(existingTestSchema || /^test_channel_v101_codex_\d+$/.test(schema));
  let ownsTestTables = false;
  let createdDatabase = false;
  try {
    if (existingTestSchema) {
      const [existing] = await admin.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=?", [schema]);
      assert.equal(existing.length, 0, "isolated test schema must be empty before use");
      ownsTestTables = true;
    } else {
      await admin.query("CREATE DATABASE "+quote(schema));
      createdDatabase = true;
    }
    testDb=await mysql.createPool({...opts,database:schema,connectionLimit:3});
    for(const ddl of sql) await testDb.query(ddl);
    await testDb.query("INSERT INTO users VALUES (1,10,0,0),(2,0,0,0)");
    await testDb.query("ALTER TABLE users ADD COLUMN status VARCHAR(20) DEFAULT 'active', ADD COLUMN is_banned TINYINT DEFAULT 0");
    await testDb.query("INSERT INTO campaigns VALUES (10,'active',10,0,'direct_debit',5),(11,'active',10,0,'direct_debit',5)");
    await testDb.query("INSERT INTO campaign_posts VALUES (100,10,5,0,0,0),(101,11,200,0,0,0)");
    await testDb.query("ALTER TABLE campaigns ADD COLUMN pause_reason VARCHAR(40) NULL, ADD COLUMN status_before_creative_review VARCHAR(40) NULL, ADD COLUMN approved_creative_revision_id BIGINT NULL, ADD COLUMN pending_creative_revision_id BIGINT NULL, ADD COLUMN user_id BIGINT DEFAULT 1, ADD COLUMN type VARCHAR(16) DEFAULT 'clicks', ADD COLUMN campaign_kind VARCHAR(32) DEFAULT 'standard', ADD COLUMN cpm DECIMAL(20,8) DEFAULT 10, ADD COLUMN cpc DECIMAL(20,8) DEFAULT 65, ADD COLUMN channel_spend DECIMAL(20,8) DEFAULT 0");
    await testDb.query("ALTER TABLE campaign_posts ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'active', ADD COLUMN delivery_confirmed_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6), ADD COLUMN delivery_failed_at DATETIME(6) NULL, ADD COLUMN deleted_at DATETIME(6) NULL, ADD COLUMN view_accepted_at DATETIME(6) NULL, ADD COLUMN billing_cutoff_at DATETIME(6) NULL, ADD COLUMN channel_id BIGINT DEFAULT 50, ADD COLUMN fraud_excluded_clicks BIGINT DEFAULT 0, ADD COLUMN view_fetch_status VARCHAR(32) DEFAULT 'success', ADD COLUMN view_fetch_source VARCHAR(32) DEFAULT 'public_api'");
    await testDb.query("ALTER TABLE campaign_clicks ADD COLUMN accepted_at DATETIME(6) NULL");
    await testDb.query("CREATE TABLE channels (id BIGINT PRIMARY KEY,user_id BIGINT,status VARCHAR(32),under_review TINYINT,settlement_excluded_until DATETIME NULL,revenue_protection_status VARCHAR(32),view_tracking_status VARCHAR(32),subscriber_count BIGINT,is_deleted TINYINT DEFAULT 0)");
    await testDb.query("INSERT INTO channels VALUES (50,2,'active',0,NULL,'normal','active',10000,0)");
    await testDb.query("CREATE TABLE channel_fraud_events (channel_id BIGINT, post_id BIGINT NULL, campaign_id BIGINT NULL, billing_state VARCHAR(32), false_positive_at DATETIME NULL)");
    await testDb.query("INSERT INTO channel_reserve_treasury_control VALUES (1)");
    await testDb.query("INSERT INTO channel_reserve_treasury_ledger (idempotency_key,entry_type,direction,amount,campaign_id) VALUES ('verified-campaign-10-charge','allocation_inflow','in',1,10)");
    process.env.CHANNEL_V101_UNIFIED_SETTLEMENT_ENABLED="true";
    process.env.CHANNEL_V101_RESERVE_TREASURY_ENABLED="true";
    process.env.CHANNEL_V101_CPC_PRIORITY_PAYOUT_ENABLED="false";
    process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED="false";
    const m=load("src/lib/channelUnifiedSettlement.ts");
    const split={publisherPercent:60,platformPercent:30,reservePercent:10};
    const c=await testDb.getConnection();
    try {
      await c.beginTransaction();
      const a=await m.settleCanonicalCpcZeroClickAdvance(c,{campaignId:10,postId:100,channelId:50,publisherId:2,campaignType:"clicks",eligibleViews:5,validationResult:{eligible:true}});
      assert.equal(a.fundingDeltaDecimal,"0.00466667");
      await c.commit();
      await c.beginTransaction();
      const replay=await m.settleCanonicalCpcZeroClickAdvance(c,{campaignId:10,postId:100,channelId:50,publisherId:2,campaignType:"clicks",eligibleViews:5,validationResult:{eligible:true}});
      assert.equal(replay.fundingDeltaDecimal,"0.00000000");
      await c.commit();
      await testDb.query("INSERT INTO campaign_clicks (id,campaign_id,post_id,is_bot) VALUES (900,10,100,0)");
      await c.beginTransaction();
      const click=await m.settleCanonicalCpcClick(c,{campaignId:10,postId:100,channelId:50,publisherId:2,advertiserId:1,clickId:900,clickUnitPrice:"0.06500000",revenueSplit:split});
      assert.equal(click.arrRecoveredDecimal,"0.00466667");
      assert.equal(click.publisherCreditDecimal,"0.03433333");
      const duplicateClick=await m.settleCanonicalCpcClick(c,{campaignId:10,postId:100,channelId:50,publisherId:2,advertiserId:1,clickId:900,clickUnitPrice:"0.06500000",revenueSplit:split});
      assert.equal(duplicateClick.status,"duplicate");
      await c.commit();
      await c.beginTransaction();
      const base={campaignId:11,postId:101,channelId:50,publisherId:2,advertiserId:1,cpmRate:"10.00000000",revenueSplit:split};
      const first=await m.settleCanonicalCpmViews(c,{...base,confirmedViews:100});
      const second=await m.settleCanonicalCpmViews(c,{...base,confirmedViews:200});
      assert.equal(first.advertiserDebitDecimal,"1.00000000");
      assert.equal(second.advertiserDebitDecimal,"1.00000000");
      await c.commit();
    } catch(error){await c.rollback();throw error} finally {c.release()}
    await testDb.query("INSERT INTO campaigns(id,status,budget,spend,funding_model,daily_budget_limit) VALUES (12,'active',10,0,'direct_debit',5),(13,'active',10,0,'direct_debit',5),(14,'active',10,0,'direct_debit',0.5)");
    await testDb.query("INSERT INTO campaign_posts(id,campaign_id,views,settled_views,settled_clicks,spend) VALUES (104,14,100,0,0,0)");
    const capConn=await testDb.getConnection();
    try {
      await capConn.beginTransaction();
      await assert.rejects(m.settleCanonicalCpmViews(capConn,{campaignId:14,postId:104,channelId:50,publisherId:2,advertiserId:1,confirmedViews:100,cpmRate:"10.00000000",revenueSplit:split}),/v101_daily_cap_reached/);
      await capConn.rollback();
    } finally {capConn.release()}
    await testDb.query("INSERT INTO campaign_posts(id,campaign_id,views,settled_views,settled_clicks,spend) VALUES (102,12,7,0,0,0),(103,13,1,0,0,0)");
    await testDb.query("INSERT INTO channel_reserve_treasury_ledger (idempotency_key,entry_type,direction,amount,campaign_id) VALUES ('verified-campaign-12-charge','allocation_inflow','in',1,12)");
    const concurrent = await Promise.all([1,2].map(async () => {
      const conn = await testDb.getConnection();
      try {
        await conn.beginTransaction();
        const result = await m.settleCanonicalCpcZeroClickAdvance(conn,{
          campaignId:12,postId:102,channelId:50,publisherId:2,campaignType:"clicks",
          eligibleViews:7,validationResult:{eligible:true},
        });
        await conn.commit();
        return result.fundingDeltaDecimal;
      } catch(error){await conn.rollback();throw error} finally {conn.release()}
    }));
    assert.deepEqual(concurrent.sort(),["0.00000000","0.00640000"]);
    const [[onlyOneAdvance]]=await testDb.query("SELECT COUNT(*) n,COALESCE(SUM(amount),0) total FROM channel_reserve_treasury_ledger WHERE campaign_id=12 AND entry_type='advance_outflow'");
    assert.equal(onlyOneAdvance.n,1);
    assert.equal(onlyOneAdvance.total,"0.00640000");
    await testDb.query("INSERT INTO channel_reserve_treasury_ledger (idempotency_key,entry_type,direction,amount,campaign_id) VALUES ('verified-campaign-13-charge','allocation_inflow','in',1,13)");
    await testDb.query("CREATE TRIGGER trg_fail_camp13 BEFORE INSERT ON channel_unified_settlement_events FOR EACH ROW BEGIN IF NEW.campaign_id = 13 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'v101_advance_credit_failed'; END IF; END");
    const failedConn=await testDb.getConnection();
    try {
      await failedConn.beginTransaction();
      const mismatch = await m.settleCanonicalCpcZeroClickAdvance(failedConn,{campaignId:13,postId:103,channelId:50,publisherId:99,campaignType:"clicks",eligibleViews:1,validationResult:{eligible:true}});
      assert.equal(mismatch.status, "rejected");
      assert.equal(mismatch.reason, "publisher_mismatch");
      await assert.rejects(
        m.settleCanonicalCpcZeroClickAdvance(failedConn,{campaignId:13,postId:103,channelId:50,publisherId:2,campaignType:"clicks",eligibleViews:1,validationResult:{eligible:true}}),
        /v101_advance_credit_failed/
      );
      await failedConn.rollback();
    } finally {
      failedConn.release();
      await testDb.query("DROP TRIGGER IF EXISTS trg_fail_camp13");
    }
    const [[rolledBack]]=await testDb.query("SELECT COUNT(*) n FROM channel_cpc_reserve_advances WHERE campaign_id=13");
    assert.equal(rolledBack.n,0);
    await testDb.query("CREATE TABLE advertiser_rate_discounts (user_id BIGINT PRIMARY KEY,expires_at DATETIME,cpc_discount DECIMAL(20,8),cpm_discount DECIMAL(20,8))");
    await testDb.query("CREATE TABLE settings (`key` VARCHAR(100) PRIMARY KEY,value VARCHAR(100))");
    await testDb.query("INSERT INTO settings VALUES ('platform_margin_percent','30'),('safety_reserve_percent','14.28571429')");
    await testDb.query("INSERT INTO campaigns (id,status,budget,spend,funding_model,daily_budget_limit,user_id,type,campaign_kind,cpm,cpc) VALUES (20,'active',5,0,'direct_debit',5,1,'clicks','standard',10,65),(21,'active',5,0,'direct_debit',5,1,'clicks','standard',10,65)");
    await testDb.query("INSERT INTO campaign_posts (id,campaign_id,views,settled_views,settled_clicks,spend,channel_id,status,delivery_confirmed_at,view_fetch_status,view_fetch_source) VALUES (201,20,5,0,0,0,50,'active',UTC_TIMESTAMP(),'success','public_api'),(202,21,5,0,0,0,50,'active',UTC_TIMESTAMP(),'success','public_api')");
    const billing=load("src/lib/channelFastBilling.ts");
    const views=await Promise.all([billing.debitConfirmedChannelViews(201,5),billing.debitConfirmedChannelViews(202,5)]);
    assert.equal(views.filter(x=>x.debited).length,0, "CPC views are not advertiser charges");
    const [[twoAdvances]]=await testDb.query("SELECT COUNT(*) n,COALESCE(SUM(advanced_amount),0) total FROM channel_cpc_reserve_advances WHERE campaign_id IN (20,21)");
    assert.equal(twoAdvances.n,2, "unfunded opportunities remain queued");
    assert.equal(twoAdvances.total,"0.00000000");
    await testDb.query("INSERT INTO campaign_clicks(id,campaign_id,post_id,is_bot) VALUES (901,20,201,0),(902,21,202,0)");
    const clicks=await Promise.all([billing.debitChannelClick(201,901),billing.debitChannelClick(202,902)]);
    assert.equal(clicks.filter(x=>x.debited).length,2);
    const [[multiWallet]]=await testDb.query("SELECT ad_balance FROM users WHERE id=1");
    assert.equal(multiWallet.ad_balance,"7.80500000");
    const [[multiRecovery]]=await testDb.query("SELECT COALESCE(SUM(recovered_amount),0) total FROM channel_cpc_reserve_advances WHERE campaign_id IN (20,21)");
    assert.equal(multiRecovery.total,"0.00000000");
    const [[wallet]]=await testDb.query("SELECT ad_balance,balance_locked FROM users WHERE id=1");
    assert.equal(wallet.ad_balance,"7.80500000");
    const [[publisher]]=await testDb.query("SELECT balance_available,balance_locked FROM users WHERE id=2");
    assert.equal(publisher.balance_available,"1.32340000");
    assert.equal(publisher.balance_locked,"0.00000000");
    const [[debits]]=await testDb.query("SELECT COUNT(*) n,COALESCE(SUM(amount),0) total FROM advertiser_direct_debits");
    assert.equal(debits.n,5);
    assert.equal(debits.total,"2.19500000");
    const [[post]]=await testDb.query("SELECT settled_views FROM campaign_posts WHERE id=101");
    assert.equal(post.settled_views,200);

    // Exercise the new writer against isolated, funded direct-debit rows.
    for(const file of ["db/migrations/20261102_1200_channel_cpm_pending.sql","db/migrations/20261102_1210_cpm_window_finalization.sql"]) {
      const text=fs.readFileSync(file,"utf8");
      for(const statement of text.split(";").map(x=>x.trim()).filter(Boolean)) await testDb.query(statement);
    }
    await testDb.query("INSERT INTO campaigns (id,status,budget,spend,funding_model,daily_budget_limit,user_id,type,campaign_kind,cpm,cpc) VALUES (23,'active',5,0,'direct_debit',5,1,'views','standard',10,0)");
    await testDb.query("INSERT INTO campaign_posts (id,campaign_id,views,settled_views,settled_clicks,spend,channel_id,status,delivery_confirmed_at,view_fetch_status,view_fetch_source) VALUES (205,23,5,0,0,0,50,'active',UTC_TIMESTAMP(),'success','public_api')");
    const [[balanceBeforeWindow]]=await testDb.query("SELECT balance_available,balance_locked FROM users WHERE id=2");
    process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED="true";
    const windowConn=await testDb.getConnection();
    try {
      await windowConn.beginTransaction();
      const charge=await m.settleCanonicalCpmViews(windowConn,{campaignId:23,postId:205,channelId:50,publisherId:2,advertiserId:1,confirmedViews:5,cpmRate:"10.00000000",revenueSplit:split});
      assert.equal(charge.advertiserDebitDecimal,"0.05000000");
      assert.equal(charge.publisherCreditDecimal,"0.00000000");
      assert.equal(charge.platformRevenueDecimal,"0.01500000");
      assert.equal(charge.reserveAllocationDecimal,"0.00500000");
      await windowConn.commit();
    } catch(e) {await windowConn.rollback();throw e} finally {windowConn.release();delete process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED}
    process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED="true";
    const replayWindow=await testDb.getConnection();
    try {await replayWindow.beginTransaction();const again=await m.settleCanonicalCpmViews(replayWindow,{campaignId:23,postId:205,channelId:50,publisherId:2,advertiserId:1,confirmedViews:5,cpmRate:"10.00000000",revenueSplit:split});assert.equal(again.status,"duplicate");await replayWindow.commit()} catch(e){await replayWindow.rollback();throw e} finally {replayWindow.release();delete process.env.CHANNEL_V101_CPM_WINDOWS_ENABLED}
    const [[oneCharge]]=await testDb.query("SELECT COUNT(*) n FROM advertiser_direct_debits WHERE campaign_id=23");
    const [[oneLiability]]=await testDb.query("SELECT COUNT(*) n FROM channel_cpm_pending_allocations WHERE campaign_id=23");
    assert.equal(oneCharge.n,1);assert.equal(oneLiability.n,1);
    const [[windowRow]]=await testDb.query("SELECT neutral_entitlement,status FROM channel_cpm_pending_allocations WHERE campaign_id=23");
    const [[debitRow]]=await testDb.query("SELECT publisher_status FROM channel_advertiser_debits WHERE campaign_id=23");
    const [[balanceAfterWindow]]=await testDb.query("SELECT balance_available,balance_locked FROM users WHERE id=2");
    assert.equal(windowRow.neutral_entitlement,"0.03000000");assert.equal(windowRow.status,"pending");
    assert.equal(debitRow.publisher_status,"window_pending");assert.equal(balanceAfterWindow.balance_available,balanceBeforeWindow.balance_available);assert.equal(balanceAfterWindow.balance_locked,balanceBeforeWindow.balance_locked);

    // The approved recovery worker uses the same canonical transaction path.
    await testDb.query("INSERT INTO campaigns (id,status,budget,spend,funding_model,daily_budget_limit,user_id,type,campaign_kind,cpm,cpc) VALUES (22,'active',5,0,'direct_debit',5,1,'views','standard',10,0)");
    await testDb.query("INSERT INTO campaign_posts (id,campaign_id,views,settled_views,settled_clicks,spend,channel_id,status,delivery_confirmed_at,view_fetch_status,view_fetch_source) VALUES (203,22,5,0,0,0,50,'active',UTC_TIMESTAMP(),'success','public_api')");
    const batch = load("src/lib/channelSettlement.ts");
    const firstBatch = await batch.settleChannelCampaigns({ campaignId: 22, skipGlobalMaintenance: true });
    const replayBatch = await batch.settleChannelCampaigns({ campaignId: 22, skipGlobalMaintenance: true });
    const [[batchPost]] = await testDb.query("SELECT settled_views FROM campaign_posts WHERE id=203");
    const [[batchEvents]] = await testDb.query("SELECT COUNT(*) n,COALESCE(SUM(advertiser_debit),0) debit FROM channel_unified_settlement_events WHERE campaign_id=22");
    assert.equal(firstBatch.settledPosts, 1);
    assert.equal(replayBatch.settledPosts, 0);
    assert.equal(batchPost.settled_views, 5);
    assert.equal(batchEvents.n, 1);
    assert.equal(batchEvents.debit, "0.05000000");

    // One unchanged Telegram placement, three successive cumulative snapshots.
    // Calendar attribution itself is verified separately by the window tests.
    await testDb.query("INSERT INTO campaigns (id,status,budget,spend,funding_model,daily_budget_limit,user_id,type,campaign_kind,cpm,cpc) VALUES (24,'active',10,0,'direct_debit',10,1,'views','standard',1,0)");
    await testDb.query("INSERT INTO campaign_posts (id,campaign_id,views,settled_views,settled_clicks,spend,channel_id,status,delivery_confirmed_at,view_fetch_status,view_fetch_source) VALUES (206,24,1000,0,0,0,50,'active',UTC_TIMESTAMP(),'success','public_api'),(207,24,100,0,0,0,50,'active',UTC_TIMESTAMP(),'success','public_api')");
    async function settleSnapshot(postId,views,price) {
      const conn=await testDb.getConnection();
      try {
        await conn.beginTransaction();
        const result=await m.settleCanonicalCpmViews(conn,{campaignId:24,postId,channelId:50,publisherId:2,advertiserId:1,confirmedViews:views,cpmRate:price,revenueSplit:split});
        await conn.commit();return result;
      } catch(error){await conn.rollback();throw error} finally{conn.release()}
    }
    const d1=await settleSnapshot(206,1000,"1.00000000");
    assert.equal(d1.advertiserDebitDecimal,"1.00000000");
    assert.equal((await settleSnapshot(206,1000,"1.00000000")).status,"duplicate");
    await testDb.query("UPDATE campaign_posts SET views=1400 WHERE id=206");
    const d2=await settleSnapshot(206,1400,"2.00000000");
    assert.equal(d2.advertiserDebitDecimal,"0.80000000");
    assert.equal((await settleSnapshot(206,1400,"2.00000000")).status,"duplicate");
    await testDb.query("UPDATE campaign_posts SET views=1900 WHERE id=206");
    const d3=await settleSnapshot(206,1900,"1.50000000");
    assert.equal(d3.advertiserDebitDecimal,"0.75000000");
    assert.equal((await settleSnapshot(206,1900,"1.50000000")).status,"duplicate");
    const other=await settleSnapshot(207,100,"1.00000000");
    assert.equal(other.advertiserDebitDecimal,"0.10000000");
    const [[samePost]]=await testDb.query("SELECT COUNT(*) events,SUM(units) units,SUM(advertiser_debit) debit,SUM(publisher_credit) publisher,SUM(platform_revenue) platform,SUM(reserve_contribution) reserve_amount FROM channel_unified_settlement_events WHERE campaign_id=24 AND post_id=206");
    assert.deepEqual([samePost.events,Number(samePost.units),samePost.debit,samePost.publisher,samePost.platform,samePost.reserve_amount],[3,1900,"2.55000000","1.53000000","0.76500000","0.25500000"]);
    const [[all24]]=await testDb.query("SELECT SUM(advertiser_debit) debit,SUM(publisher_credit) publisher,SUM(platform_revenue) platform,SUM(reserve_contribution) reserve_amount FROM channel_unified_settlement_events WHERE campaign_id=24");
    assert.deepEqual([all24.debit,all24.publisher,all24.platform,all24.reserve_amount],["2.65000000","1.59000000","0.79500000","0.26500000"]);
    const [[samePostCounter]]=await testDb.query("SELECT settled_views FROM campaign_posts WHERE id=206");
    assert.equal(samePostCounter.settled_views,1900);
    const [[onePublisher]]=await testDb.query("SELECT COUNT(*) n,COALESCE(SUM(amount),0) amount FROM advertiser_direct_debits WHERE campaign_id=24 AND source_key LIKE 'channel:v101:cpm_view:%'");
    assert.equal(onePublisher.n,4);assert.equal(onePublisher.amount,"2.65000000");

    // An accepted event may be billed after Telegram confirms removal. New
    // post-cutoff evidence must never use that recovery permission.
    await testDb.query("UPDATE campaigns SET status='paused',pause_reason='moderation_cleanup',approved_creative_revision_id=7 WHERE id IN (20,22)");
    await testDb.query("UPDATE campaign_posts SET status='deleted',deleted_at=NOW(6),billing_cutoff_at=NOW(6) WHERE id=201");
    await testDb.query("INSERT INTO campaign_clicks(id,campaign_id,post_id,is_bot,accepted_at) VALUES (903,20,201,0,DATE_SUB(NOW(6),INTERVAL 1 SECOND)),(904,20,201,0,DATE_ADD(NOW(6),INTERVAL 1 SECOND))");
    const [[clickDebitsBefore]]=await testDb.query("SELECT COUNT(*) n FROM channel_unified_settlement_events WHERE campaign_id=20 AND settlement_type='cpc_click'");
    const acceptedAfterDelete=await billing.debitChannelClick(201,903);
    assert.equal(acceptedAfterDelete.debited,true);
    assert.equal((await billing.debitChannelClick(201,903)).debited,false);
    assert.equal((await billing.debitChannelClick(201,904)).debited,false);
    const [[clickDebitsAfter]]=await testDb.query("SELECT COUNT(*) n FROM channel_unified_settlement_events WHERE campaign_id=20 AND settlement_type='cpc_click'");
    assert.equal(clickDebitsAfter.n,clickDebitsBefore.n+1);

    await testDb.query("UPDATE campaign_posts SET views=8,status='deleted',view_accepted_at=DATE_SUB(NOW(6),INTERVAL 1 SECOND),deleted_at=NOW(6),billing_cutoff_at=NOW(6) WHERE id=203");
    const acceptedViewsAfterDelete=await billing.debitConfirmedChannelViews(203,8);
    assert.equal(acceptedViewsAfterDelete.debited,true);
    assert.equal((await billing.debitConfirmedChannelViews(203,8)).debited,false);
    const [[viewCounter]]=await testDb.query("SELECT settled_views FROM campaign_posts WHERE id=203");
    assert.equal(viewCounter.settled_views,8);
  } finally {
    if(testDb) await testDb.end();
    if (createdDatabase) await admin.query("DROP DATABASE "+quote(schema));
    if (ownsTestTables) {
      const ownedNames = ["settings","advertiser_rate_discounts","channels","channel_fraud_events",...sql.map(ddl => ddl.match(/^CREATE TABLE (\w+)/)[1])];
      await admin.query("DROP TABLE IF EXISTS "+ownedNames.map(name => quote(schema)+"."+quote(name)).join(","));
    }
    await admin.end();
  }
});
