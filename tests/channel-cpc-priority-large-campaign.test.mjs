import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import {createRequire} from "node:module";
dotenv.config({path:".env",quiet:true});
const native=createRequire(import.meta.url),cache=new Map();
let pool;
function load(path){if(cache.has(path))return cache.get(path);const js=ts.transpileModule(fs.readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const mod={exports:{}};const dependencies={"@/lib/db":{default:pool},"@/lib/channelDailySpend":{},"@/lib/channelAllocationLedger":{},"@/lib/channelCpmPendingSettlement":{},"@/lib/advertiserDirectDebit":{},"@/lib/statFormulas":{}};new Function("module","exports","require",js)(mod,mod.exports,name=>{if(dependencies[name])return dependencies[name];if(name==="./financialPostingContext")return load("src/lib/financialPostingContext.ts");if(name==="./channelAllocationMath")return load("src/lib/channelAllocationMath.ts");if(name.startsWith("@/lib/")){const target="src/lib/"+name.slice(6)+".ts";return fs.existsSync(target)?load(target):{}}return native(name)});cache.set(path,mod.exports);return mod.exports}
const opts={host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASS};
const mathUnits=load("src/lib/channelAllocationMath.ts").decimalToUnits;
const schema="test_cpc_priority_large_"+Date.now(),quote=x=>"\u0060"+x+"\u0060";
const now=1_800_000_000;
test("disabled adapter never touches database",async()=>{const prior=process.env.CHANNEL_V101_CPC_PRIORITY_PAYOUT_ENABLED;delete process.env.CHANNEL_V101_CPC_PRIORITY_PAYOUT_ENABLED;try{const {fundCpcPriorityCampaign}=load("src/lib/channelCpcPriorityPayout.ts");assert.equal((await fundCpcPriorityCampaign({query(){throw new Error("db_access")}},10,now)).status,"disabled")}finally{if(prior===undefined)delete process.env.CHANNEL_V101_CPC_PRIORITY_PAYOUT_ENABLED;else process.env.CHANNEL_V101_CPC_PRIORITY_PAYOUT_ENABLED=prior}});
test("disposable MariaDB CPC priority payouts",async t=>{
 const old={priority:process.env.CHANNEL_V101_CPC_PRIORITY_PAYOUT_ENABLED,unified:process.env.CHANNEL_V101_UNIFIED_SETTLEMENT_ENABLED,reserve:process.env.CHANNEL_V101_RESERVE_TREASURY_ENABLED};
 const admin=await mysql.createConnection({...opts,database:process.env.DB_NAME});let created=false;
 try{
  assert.match(schema,/^test_cpc_priority_large_\d+$/);await admin.query("CREATE DATABASE "+quote(schema));created=true;
  pool=mysql.createPool({...opts,database:schema,connectionLimit:8});
  const ddl=[
   "CREATE TABLE users (id INT PRIMARY KEY,ad_balance DECIMAL(20,8) DEFAULT 0,balance_available DECIMAL(20,8) DEFAULT 0,balance_locked DECIMAL(20,8) DEFAULT 0,is_banned TINYINT DEFAULT 0,status VARCHAR(30) DEFAULT 'active') ENGINE=InnoDB",
   "CREATE TABLE campaigns (id INT PRIMARY KEY,user_id INT,type VARCHAR(20),status VARCHAR(20),pause_reason VARCHAR(40),approved_creative_revision_id BIGINT UNSIGNED NULL,pending_creative_revision_id BIGINT UNSIGNED NULL,status_before_creative_review VARCHAR(40),funding_model VARCHAR(30) DEFAULT 'direct_debit',campaign_kind VARCHAR(30) DEFAULT 'standard') ENGINE=InnoDB",
   "CREATE TABLE channels (id INT PRIMARY KEY,user_id INT,status VARCHAR(30),under_review TINYINT DEFAULT 0,is_deleted TINYINT DEFAULT 0,settlement_excluded_until DATETIME NULL,revenue_protection_status VARCHAR(30),view_tracking_status VARCHAR(30),subscriber_count INT DEFAULT 1000) ENGINE=InnoDB",
   "CREATE TABLE campaign_posts (id INT PRIMARY KEY,campaign_id INT,channel_id INT,views INT,settled_views INT DEFAULT 0,settled_clicks INT DEFAULT 0,fraud_excluded_clicks INT DEFAULT 0,status VARCHAR(30) DEFAULT 'active',deleted_at DATETIME NULL,delivery_confirmed_at DATETIME,delivery_failed_at DATETIME NULL,last_views_update DATETIME(6) NULL,view_fetch_status VARCHAR(30),view_fetch_source VARCHAR(30)) ENGINE=InnoDB",
   "CREATE TABLE campaign_clicks (id INT AUTO_INCREMENT PRIMARY KEY,campaign_id INT,post_id INT,is_bot TINYINT DEFAULT 0,created_at DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB",
   "CREATE TABLE channel_view_waivers (post_id INT,waived_views INT) ENGINE=InnoDB",
   "CREATE TABLE channel_fraud_events (channel_id INT,post_id INT NULL,campaign_id INT NULL,billing_state VARCHAR(30),false_positive_at DATETIME NULL) ENGINE=InnoDB",
   "CREATE TABLE channel_allocation_ledger (id INT PRIMARY KEY) ENGINE=InnoDB",
   "CREATE TABLE channel_reserve_treasury_control (id INT PRIMARY KEY) ENGINE=InnoDB",
   "CREATE TABLE channel_reserve_treasury_ledger (id BIGINT AUTO_INCREMENT PRIMARY KEY,idempotency_key VARCHAR(191) UNIQUE,entry_type VARCHAR(30),direction VARCHAR(5),amount DECIMAL(20,8),campaign_id INT,post_id INT,publisher_id INT,policy_version VARCHAR(64),created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6)) ENGINE=InnoDB",
   "CREATE TABLE channel_cpc_reserve_advances (id BIGINT AUTO_INCREMENT PRIMARY KEY,campaign_id INT,publisher_id INT,post_id INT,channel_id INT,entitled_views INT,entitled_amount DECIMAL(20,8),advanced_amount DECIMAL(20,8),recovered_amount DECIMAL(20,8) DEFAULT 0,unfunded_queue_amount DECIMAL(20,8),status VARCHAR(30),policy_version VARCHAR(64),updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY uq_campaign_pub(campaign_id,publisher_id)) ENGINE=InnoDB",
   "CREATE TABLE channel_cpc_reserve_advance_posts (id BIGINT AUTO_INCREMENT PRIMARY KEY,advance_id BIGINT,campaign_id INT,post_id INT UNIQUE,channel_id INT,publisher_id INT,eligible_views INT,allocated_advance DECIMAL(20,8),updated_at DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB",
   "CREATE TABLE channel_arr_transitions (id BIGINT AUTO_INCREMENT PRIMARY KEY,advance_id BIGINT,campaign_id INT,post_id INT,publisher_id INT) ENGINE=InnoDB",
   "CREATE TABLE channel_unified_settlement_events (id BIGINT AUTO_INCREMENT PRIMARY KEY,idempotency_key VARCHAR(191) UNIQUE,settlement_type VARCHAR(40),campaign_id INT,post_id INT,channel_id INT,publisher_id INT,advertiser_id INT,units INT,unit_price DECIMAL(20,8),advertiser_debit DECIMAL(20,8),publisher_credit DECIMAL(20,8),platform_revenue DECIMAL(20,8),reserve_contribution DECIMAL(20,8),arr_recovered DECIMAL(20,8),status VARCHAR(30)) ENGINE=InnoDB",
  ];for(const q of ddl)await pool.query(q);
  const scanSql=fs.readFileSync("db/migrations/20261103_1200_channel_cpc_priority_scan.sql","utf8").split(/\r?\n/).filter(line=>!line.trimStart().startsWith("--")).join("\n");for(const q of scanSql.split(";").map(x=>x.trim()).filter(Boolean))await pool.query(q);
  const ledger=fs.readFileSync("db/migrations/20261101_0800_publisher_balance_events.sql","utf8").split(/\r?\n/).filter(line=>!line.trimStart().startsWith("--")).join("\n");for(const q of ledger.split(";").map(x=>x.trim()).filter(Boolean))await pool.query(q);
  await pool.query("INSERT INTO users (id) VALUES (1),(2),(3),(4),(5),(6)");
  await pool.query("INSERT INTO campaigns (id,user_id,type,status) VALUES (10,1,'clicks','active'),(11,1,'clicks','active'),(12,1,'clicks','active'),(13,1,'clicks','active')");
  await pool.query("INSERT INTO channels (id,user_id,status,revenue_protection_status,view_tracking_status) VALUES (20,2,'active','clear','active'),(21,3,'active','clear','active'),(22,4,'active','clear','active'),(23,5,'active','clear','active'),(24,6,'active','clear','active')");
  await pool.query("INSERT INTO channel_reserve_treasury_control VALUES (1)");
  const post=async(id,campaign,channel,views,ageHours=1)=>pool.query("INSERT INTO campaign_posts (id,campaign_id,channel_id,views,delivery_confirmed_at,view_fetch_status,view_fetch_source) VALUES (?,?,?,?,FROM_UNIXTIME(?),'success','public_api')",[id,campaign,channel,views,now-ageHours*3600]);
  const funding=async(campaign,amount,key)=>pool.query("INSERT INTO channel_reserve_treasury_ledger (idempotency_key,entry_type,direction,amount,campaign_id) VALUES (?,'allocation_inflow','in',?,?)",[key,amount,campaign]);
  const tx=async(campaign,options={})=>{const conn=await pool.getConnection();try{await conn.beginTransaction();const result=await load("src/lib/channelCpcPriorityPayout.ts").fundCpcPriorityCampaign(conn,campaign,now);if(options.rollback)await conn.rollback();else await conn.commit();return result}catch(e){await conn.rollback();throw e}finally{conn.release()}};
  process.env.CHANNEL_V101_CPC_PRIORITY_PAYOUT_ENABLED="true";process.env.CHANNEL_V101_UNIFIED_SETTLEMENT_ENABLED="true";process.env.CHANNEL_V101_RESERVE_TREASURY_ENABLED="true";
  await post(100,10,20,80);await post(101,10,21,60);await post(102,10,22,5,720);await post(103,10,20,20);await funding(10,"0.20000000","fund10");
  await t.test("priority, multi-post attribution, cap, source ledger, and exact split preservation",async()=>{const r=await tx(10);assert.equal(r.status,"processed");assert.equal(r.proposal.ranked[0].publisherId,4);assert.equal(r.credited[0].publisherId,4);assert.equal(r.totalCredited,"0.07266667");assert.deepEqual(r.credited.filter(x=>x.publisherId===2).map(x=>x.postId),[100,103]);const [[debits]]=await pool.query("SELECT COUNT(*) n FROM channel_unified_settlement_events WHERE advertiser_debit>0 OR platform_revenue>0");assert.equal(debits.n,0);const [[arr]]=await pool.query("SELECT COUNT(*) n FROM channel_cpc_reserve_advances WHERE campaign_id=10");assert.equal(arr.n,3);const [[events]]=await pool.query("SELECT COUNT(*) n FROM publisher_balance_events WHERE source_system='channel_v101_advance'");assert.equal(events.n,r.credited.length)});
  await t.test("retry cannot duplicate payment",async()=>{const before=await pool.query("SELECT SUM(amount) total FROM channel_reserve_treasury_ledger WHERE campaign_id=10 AND entry_type='advance_outflow'");const r=await tx(10);const after=await pool.query("SELECT SUM(amount) total FROM channel_reserve_treasury_ledger WHERE campaign_id=10 AND entry_type='advance_outflow'");assert.equal(r.totalCredited,"0.00000000");assert.deepEqual(after,before)});
  await post(200,11,23,100);await funding(11,"0.01000000","fund11");
  await t.test("partial funding retains entitlement and campaign floor",async()=>{const r=await tx(11);assert.equal(r.totalCredited,"0.00700000");const [[a]]=await pool.query("SELECT advanced_amount,unfunded_queue_amount FROM channel_cpc_reserve_advances WHERE campaign_id=11");assert.equal(a.advanced_amount,"0.00700000");assert.equal(a.unfunded_queue_amount,"0.03300000");assert.equal(r.remainingReserve,"0.00000000")});
  await t.test("new same-campaign funding can pay remainder",async()=>{await funding(11,"0.01000000","fund11b");const r=await tx(11);assert.equal(r.totalCredited,"0.00700000");const [[a]]=await pool.query("SELECT advanced_amount FROM channel_cpc_reserve_advances WHERE campaign_id=11");assert.equal(a.advanced_amount,"0.01400000")});
  await post(300,12,24,100);await t.test("other campaign reserve cannot fund",async()=>assert.equal((await tx(12)).totalCredited,"0.00000000"));
  await funding(12,"0.10000000","fund12");
  await t.test("rolled-back transaction has no credit or reserve use",async()=>{const r=await tx(12,{rollback:true});assert.equal(r.totalCredited,"0.04000000");const [[a]]=await pool.query("SELECT COUNT(*) n FROM channel_cpc_reserve_advances WHERE campaign_id=12");assert.equal(a.n,0);assert.equal((await tx(12)).totalCredited,"0.04000000")});
  await post(400,13,24,100);await funding(13,"0.10000000","fund13");
  await t.test("concurrent workers serialize once",async()=>{const results=await Promise.all([tx(13),tx(13)]);assert.equal(results.reduce((n,r)=>n+Number(r.totalCredited),0),0.04);const [[a]]=await pool.query("SELECT COUNT(*) n FROM channel_cpc_reserve_advances WHERE campaign_id=13");assert.equal(a.n,1)});
  await t.test("post ledger retains source identity",async()=>{const [rows]=await pool.query("SELECT post_id,publisher_id,amount FROM channel_reserve_treasury_ledger WHERE campaign_id=10 AND entry_type='advance_outflow' ORDER BY post_id");assert.deepEqual(rows.map(x=>x.post_id),[100,101,102,103]);assert.ok(rows.every(x=>x.publisher_id>0&&x.amount>0))});
  await t.test("post allocation totals agree with reserve outflows",async()=>{const [[posts]]=await pool.query("SELECT SUM(allocated_advance) total FROM channel_cpc_reserve_advance_posts WHERE campaign_id=10");const [[outflows]]=await pool.query("SELECT SUM(amount) total FROM channel_reserve_treasury_ledger WHERE campaign_id=10 AND entry_type='advance_outflow'");assert.equal(posts.total,outflows.total)});
  await t.test("publisher cap is shared across two posts",async()=>{const [[a]]=await pool.query("SELECT advanced_amount FROM channel_cpc_reserve_advances WHERE campaign_id=10 AND publisher_id=2");assert.equal(a.advanced_amount,"0.04000000");const [p]=await pool.query("SELECT allocated_advance FROM channel_cpc_reserve_advance_posts WHERE campaign_id=10 AND publisher_id=2 ORDER BY post_id");assert.equal(mathUnits(p[0].allocated_advance)+mathUnits(p[1].allocated_advance),mathUnits(a.advanced_amount))});
  await t.test("reserve protected floor remains available",async()=>{const [[inflow]]=await pool.query("SELECT SUM(amount) total FROM channel_reserve_treasury_ledger WHERE campaign_id=10 AND entry_type='allocation_inflow'");const [[outflow]]=await pool.query("SELECT SUM(amount) total FROM channel_reserve_treasury_ledger WHERE campaign_id=10 AND entry_type='advance_outflow'");assert.ok(mathUnits(inflow.total)-mathUnits(outflow.total)>=6000000n)});
  await t.test("existing ARR recovery records are untouched",async()=>{const [[a]]=await pool.query("SELECT COUNT(*) n FROM channel_arr_transitions");assert.equal(a.n,0)});
  await t.test("publisher balance matches paid reserve",async()=>{const [[events]]=await pool.query("SELECT SUM(delta_available) total FROM publisher_balance_events WHERE source_system='channel_v101_advance'");const [[outflow]]=await pool.query("SELECT SUM(amount) total FROM channel_reserve_treasury_ledger WHERE entry_type='advance_outflow'");assert.equal(events.total,outflow.total)});
  await t.test("campaign 11 retains outstanding unpaid amount after two rounds",async()=>{const [[a]]=await pool.query("SELECT unfunded_queue_amount FROM channel_cpc_reserve_advances WHERE campaign_id=11");assert.equal(a.unfunded_queue_amount,"0.02600000")});
  await t.test("other-campaign funding cannot change campaign 10 capacity",async()=>{const reserve=load("src/lib/channelReserveTreasury.ts");const conn=await pool.getConnection();try{const state=await reserve.getReserveTreasuryBalance(conn,10);assert.equal(state.totalRealizedCapitalDecimal,"0.20000000");assert.equal(state.totalAuthorizedAdvancesDecimal,"0.07266667")}finally{conn.release()}});
  await t.test("publisher ceiling at one thousand views",async()=>{await pool.query("INSERT INTO campaigns (id,user_id,type,status) VALUES (14,1,'clicks','active')");await post(500,14,24,1000);await funding(14,"1.00000000","fund14");const r=await tx(14);assert.equal(r.totalCredited,"0.10000000");assert.equal((await tx(14)).totalCredited,"0.00000000")});
  await t.test("fraud finding excludes views",async()=>{await pool.query("INSERT INTO campaigns (id,user_id,type,status) VALUES (15,1,'clicks','active')");await post(600,15,24,100);await funding(15,"0.10000000","fund15");await pool.query("INSERT INTO channel_fraud_events VALUES (24,600,15,'confirmed_fraud',NULL)");const r=await tx(15);assert.equal(r.totalCredited,"0.00000000");assert.equal(r.proposal.excluded[0].reason,"traffic_not_validated")});
  await t.test("qualifying click excludes zero-click advance",async()=>{await pool.query("INSERT INTO campaigns (id,user_id,type,status) VALUES (16,1,'clicks','active')");await post(700,16,24,100);await funding(16,"0.10000000","fund16");await pool.query("UPDATE campaign_posts SET settled_clicks=1 WHERE id=700");const r=await tx(16);assert.equal(r.totalCredited,"0.00000000");assert.equal(r.proposal.excluded[0].reason,"qualifying_click_present")});
  await t.test("waived views are excluded",async()=>{await pool.query("INSERT INTO campaigns (id,user_id,type,status) VALUES (17,1,'clicks','active')");await post(800,17,24,100);await funding(17,"0.10000000","fund17");await pool.query("INSERT INTO channel_view_waivers VALUES (800,100)");assert.equal((await tx(17)).totalCredited,"0.00000000")});
  await t.test("channel under review is excluded",async()=>{await pool.query("INSERT INTO campaigns (id,user_id,type,status) VALUES (18,1,'clicks','active')");await post(900,18,21,100);await funding(18,"0.10000000","fund18");await pool.query("UPDATE channels SET under_review=1 WHERE id=21");assert.equal((await tx(18)).totalCredited,"0.00000000");await pool.query("UPDATE channels SET under_review=0 WHERE id=21")});
  await t.test("posting failure rolls back and then retries",async()=>{await pool.query("INSERT INTO campaigns (id,user_id,type,status) VALUES (19,1,'clicks','active')");await post(1000,19,24,100);await funding(19,"0.10000000","fund19");await pool.query("CREATE TRIGGER fail_priority_credit BEFORE UPDATE ON users FOR EACH ROW IF NEW.id=6 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected_failure'; END IF");await assert.rejects(tx(19),/injected_failure/);const [[failed]]=await pool.query("SELECT COUNT(*) n FROM channel_reserve_treasury_ledger WHERE campaign_id=19 AND entry_type='advance_outflow'");assert.equal(failed.n,0);await pool.query("DROP TRIGGER fail_priority_credit");assert.equal((await tx(19)).totalCredited,"0.04000000")});
  await t.test("transaction is required",async()=>{const conn=await pool.getConnection();try{await assert.rejects(load("src/lib/channelCpcPriorityPayout.ts").fundCpcPriorityCampaign(conn,10,now),/transaction_required/)}finally{conn.release()}});
  await t.test("non-CPC campaign fails closed",async()=>{await pool.query("INSERT INTO campaigns (id,user_id,type,status) VALUES (20,1,'views','active')");await assert.rejects(tx(20),/campaign_ineligible/)});
  await t.test("channel growth CPC campaign is excluded",async()=>{await pool.query("INSERT INTO campaigns (id,user_id,type,status,campaign_kind) VALUES (21,1,'clicks','active','channel_growth')");await assert.rejects(tx(21),/campaign_ineligible/)});
  await t.test("legacy reserved campaign cannot use priority funding",async()=>{await pool.query("INSERT INTO campaigns (id,user_id,type,status,funding_model) VALUES (22,1,'clicks','active','legacy_reserved')");await assert.rejects(tx(22),/campaign_ineligible/)});
  await t.test("underlying settlement flags are required",async()=>{delete process.env.CHANNEL_V101_UNIFIED_SETTLEMENT_ENABLED;await assert.rejects(tx(10),/underlying_flags_disabled/);process.env.CHANNEL_V101_UNIFIED_SETTLEMENT_ENABLED="true"});
  await t.test("transaction-owning entry point commits once",async()=>{await pool.query("INSERT INTO campaigns (id,user_id,type,status) VALUES (23,1,'clicks','active')");await post(1100,23,24,100);await funding(23,"0.10000000","fund23");const run=load("src/lib/channelCpcPriorityPayout.ts").processCpcPriorityCampaign;assert.equal((await run(pool,23,now)).totalCredited,"0.04000000");assert.equal((await run(pool,23,now)).totalCredited,"0.00000000")});

  const runLarge=load("src/lib/channelCpcPriorityPayout.ts").processCpcPriorityCampaign;
  async function makeLarge(campaign,count,amount="0.50000000"){
    await pool.query("INSERT INTO campaigns (id,user_id,type,status) VALUES (?,1,'clicks','active')",[campaign]);
    const base=campaign*10000;
    for(let offset=0;offset<count;offset+=500){
      const end=Math.min(count,offset+500),values=[],args=[];
      for(let i=offset;i<end;i++){
        values.push("(?,?,?,?,FROM_UNIXTIME(?),'success','public_api')");
        args.push(base+i,campaign,i===count-1?24:20,i===count-1?1000:1,
          i===count-1?now-720*3600:now-3600);
      }
      await pool.query("INSERT INTO campaign_posts (id,campaign_id,channel_id,views,delivery_confirmed_at,view_fetch_status,view_fetch_source) VALUES "+values.join(","),args);
    }
    if(amount!=="0")await funding(campaign,amount,"large-fund-"+campaign);
    return {base,lastPostId:base+count-1};
  }
  async function finishScan(campaign,max=20){
    const states=[];
    for(let i=0;i<max;i++){
      const r=await runLarge(pool,campaign,now);
      states.push(r);
      if(r.status==="scan_complete")return states;
    }
    throw new Error("scan_did_not_complete");
  }
  await t.test("exactly 1000 posts retain the original bounded path",async()=>{
    await makeLarge(30,1000);
    const r=await runLarge(pool,30,now);
    assert.equal(r.status,"processed");assert.equal(r.credited[0].publisherId,6);
  });
  await t.test("1001 posts scan with stable keyset and later-page priority",async()=>{
    const {lastPostId}=await makeLarge(31,1001);
    const scan=await finishScan(31);
    assert.deepEqual(scan.map(x=>x.scanned),[500,500,1]);
    assert.equal(scan.at(-1).cursor,lastPostId);
    const paid=await runLarge(pool,31,now);
    assert.equal(paid.status,"paid");assert.equal(paid.publisherId,6);
    assert.equal(paid.credited,"0.10000000");
    const [[a]]=await pool.query("SELECT post_id,allocated_advance FROM channel_cpc_reserve_advance_posts WHERE campaign_id=31 AND publisher_id=6");
    assert.equal(a.post_id,lastPostId);assert.equal(a.allocated_advance,"0.10000000");
  });
  await t.test("2500 posts are completely scanned across five bounded pages",async()=>{
    await makeLarge(32,2500);
    const scan=await finishScan(32);
    assert.equal(scan.length,5);assert.ok(scan.every(x=>x.scanned===500));
    const paid=await runLarge(pool,32,now);assert.equal(paid.publisherId,6);
  });
  await t.test("5000 posts preserve global priority and later-page payment",async()=>{
    const {lastPostId}=await makeLarge(33,5000);
    const scan=await finishScan(33);
    assert.equal(scan.length,10);assert.ok(scan.every(x=>x.scanned<=500));
    const [[aggregate]]=await pool.query("SELECT verified_views FROM channel_cpc_priority_scan_publishers WHERE campaign_id=33 AND publisher_id=2");
    assert.equal(Number(aggregate.verified_views),4999);
    const paid=await runLarge(pool,33,now);
    assert.equal(paid.publisherId,6);assert.equal(paid.credited,"0.10000000");
    const [[a]]=await pool.query("SELECT post_id FROM channel_cpc_reserve_advance_posts WHERE campaign_id=33 AND publisher_id=6");
    assert.equal(a.post_id,lastPostId);
  });
  await t.test("post-rich publisher receives one campaign-level cap",async()=>{
    const paid=await runLarge(pool,33,now);assert.equal(paid.publisherId,2);
    const [[a]]=await pool.query("SELECT advanced_amount FROM channel_cpc_reserve_advances WHERE campaign_id=33 AND publisher_id=2");
    assert.ok(mathUnits(a.advanced_amount)<=10000000n);
    const [[sum]]=await pool.query("SELECT SUM(allocated_advance) amount FROM channel_cpc_reserve_advance_posts WHERE campaign_id=33 AND publisher_id=2");
    assert.equal(sum.amount,a.advanced_amount);
  });
  await t.test("duplicate invocation advances the campaign round without double payment",async()=>{
    const before=(await pool.query("SELECT SUM(amount) total FROM channel_reserve_treasury_ledger WHERE campaign_id=31 AND entry_type='advance_outflow'"))[0][0].total;
    await runLarge(pool,31,now);
    const after=(await pool.query("SELECT SUM(amount) total FROM channel_reserve_treasury_ledger WHERE campaign_id=31 AND entry_type='advance_outflow'"))[0][0].total;
    assert.ok(mathUnits(after)>=mathUnits(before));
    const [[unique]]=await pool.query("SELECT COUNT(*) n,COUNT(DISTINCT idempotency_key) u FROM channel_reserve_treasury_ledger WHERE campaign_id=31");
    assert.equal(unique.n,unique.u);
  });
  await t.test("concurrent scan attempts serialize cursor progression",async()=>{
    await makeLarge(34,1001);
    const results=await Promise.all([runLarge(pool,34,now),runLarge(pool,34,now)]);
    assert.deepEqual(results.map(x=>x.scanned).sort((a,b)=>a-b),[500,500]);
    const [[s]]=await pool.query("SELECT cursor_post_id FROM channel_cpc_priority_scan_state WHERE campaign_id=34");
    assert.equal(s.cursor_post_id,340999);
  });
  await t.test("zero reserve waits and later same-campaign funding resumes",async()=>{
    await makeLarge(35,1001,"0");await finishScan(35);
    const waiting=await runLarge(pool,35,now);assert.equal(waiting.status,"waiting_funding");
    await funding(35,"0.01000000","large-fund-35");
    const paid=await runLarge(pool,35,now);
    assert.equal(paid.publisherId,6);assert.equal(paid.credited,"0.00700000");
    const [[a]]=await pool.query("SELECT unfunded_queue_amount FROM channel_cpc_reserve_advances WHERE campaign_id=35 AND publisher_id=6");
    assert.equal(a.unfunded_queue_amount,"0.09300000");
  });
  await t.test("eligibility change after scan prevents stale later-page payment",async()=>{
    await makeLarge(36,1001);await finishScan(36);
    await pool.query("UPDATE channels SET under_review=1 WHERE id=24");
    const skipped=await runLarge(pool,36,now);
    assert.equal(skipped.publisherId,6);assert.equal(skipped.credited,"0.00000000");
    await pool.query("UPDATE channels SET under_review=0 WHERE id=24");
  });
  await t.test("failed payment transaction can be retried",async()=>{
    await makeLarge(37,1001);await finishScan(37);
    await pool.query("CREATE TRIGGER fail_large_credit BEFORE UPDATE ON users FOR EACH ROW IF NEW.id=6 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected_large_failure'; END IF");
    await assert.rejects(runLarge(pool,37,now),/injected_large_failure/);
    const [[before]]=await pool.query("SELECT COUNT(*) n FROM channel_reserve_treasury_ledger WHERE campaign_id=37 AND entry_type='advance_outflow'");
    assert.equal(before.n,0);await pool.query("DROP TRIGGER fail_large_credit");
    assert.equal((await runLarge(pool,37,now)).credited,"0.10000000");
  });
  await t.test("concurrent payment attempts cannot pay one publisher twice",async()=>{
    await makeLarge(38,1001);await finishScan(38);
    const results=await Promise.all([runLarge(pool,38,now),runLarge(pool,38,now)]);
    assert.deepEqual(results.map(x=>x.publisherId).sort((a,b)=>a-b),[2,6]);
    const [[payouts]]=await pool.query("SELECT COUNT(*) n FROM channel_cpc_reserve_advances WHERE campaign_id=38 AND publisher_id=6");
    assert.equal(payouts.n,1);
    const [[reserve]]=await pool.query("SELECT SUM(amount) total FROM channel_reserve_treasury_ledger WHERE campaign_id=38 AND entry_type='advance_outflow'");
    assert.ok(mathUnits(reserve.total)<=35000000n);
  });

  const schedule=load("src/lib/channelCpcPriorityScheduler.ts").runCpcPriorityRewardSchedule;
  const previousSchedulerFlag=process.env.CHANNEL_V101_CPC_PRIORITY_SCHEDULER_ENABLED;
  await t.test("scheduler disabled without its own flag and does not access DB",async()=>{
    delete process.env.CHANNEL_V101_CPC_PRIORITY_SCHEDULER_ENABLED;
    const never={query(){throw new Error("unexpected_database_read")},getConnection(){throw new Error("unexpected_database_connection")}};
    assert.equal((await schedule(never,{asOfEpoch:now})).status,"disabled");
    process.env.CHANNEL_V101_CPC_PRIORITY_SCHEDULER_ENABLED="true";
  });
  process.env.CHANNEL_V101_CPC_PRIORITY_SCHEDULER_ENABLED="true";
  await t.test("all financial flags off leave the scheduler and legacy mode untouched",async()=>{
    const never={query(){throw new Error("unexpected_database_read")},getConnection(){throw new Error("unexpected_database_connection")}};
    delete process.env.CHANNEL_V101_CPC_PRIORITY_PAYOUT_ENABLED;
    delete process.env.CHANNEL_V101_UNIFIED_SETTLEMENT_ENABLED;
    delete process.env.CHANNEL_V101_RESERVE_TREASURY_ENABLED;
    assert.equal((await schedule(never,{asOfEpoch:now})).status,"disabled");
    assert.equal(fs.readFileSync("src/lib/channelFastBilling.ts","utf8").includes('process.env.CHANNEL_V101_CPC_PRIORITY_PAYOUT_ENABLED === "true"'),true);
    process.env.CHANNEL_V101_CPC_PRIORITY_PAYOUT_ENABLED="true";
    process.env.CHANNEL_V101_UNIFIED_SETTLEMENT_ENABLED="true";
    process.env.CHANNEL_V101_RESERVE_TREASURY_ENABLED="true";
  });
  await t.test("scheduler validates bounded options",async()=>{
    await assert.rejects(schedule(pool,{asOfEpoch:now,batchSize:0}),/invalid_options/);
    await assert.rejects(schedule(pool,{asOfEpoch:now,batchSize:51}),/invalid_options/);
  });
  await t.test("scheduler discovers multiple campaigns and records progress",async()=>{
    const r=await schedule(pool,{asOfEpoch:now,batchSize:50});
    assert.equal(r.status,"processed");assert.ok(r.outcomes.length>=4);
    assert.deepEqual(r.outcomes.map(x=>x.campaignId),[...r.outcomes.map(x=>x.campaignId)].sort((a,b)=>a-b));
    assert.ok(r.outcomes.some(x=>x.status==="waiting_funding"));
    assert.ok(r.outcomes.some(x=>x.status==="scanning"||x.status==="scan_complete"||x.status==="paid"));
  });
  await t.test("scheduler rotates bounded campaign pages deterministically",async()=>{
    const a=await schedule(pool,{asOfEpoch:now,batchSize:2,cycleSeconds:60});
    const b=await schedule(pool,{asOfEpoch:now+60,batchSize:2,cycleSeconds:60});
    assert.equal(a.outcomes.length,2);assert.equal(b.outcomes.length,2);
    assert.notEqual(a.page,b.page);assert.notDeepEqual(a.outcomes.map(x=>x.campaignId),b.outcomes.map(x=>x.campaignId));
  });
  await t.test("default scheduler page rotates on the hourly settlement cadence",async()=>{
    const first=await schedule(pool,{asOfEpoch:now,batchSize:2});
    const next=await schedule(pool,{asOfEpoch:now+3600,batchSize:2});
    assert.notEqual(first.page,next.page);
    assert.notDeepEqual(first.outcomes.map(x=>x.campaignId),next.outcomes.map(x=>x.campaignId));
  });
  await t.test("scheduler advances 5000-post campaign across invocations",async()=>{
    await makeLarge(39,5000);
    const statuses=[];
    for(let i=0;i<12;i++){
      const r=await schedule(pool,{asOfEpoch:now+i*60,batchSize:50});
      const item=r.outcomes.find(x=>x.campaignId===39);
      assert.ok(item);statuses.push(item.status);
      if(item.status==="paid")break;
    }
    assert.equal(statuses.filter(x=>x==="scanning").length,9);
    assert.equal(statuses.at(-1),"paid");
    const [[money]]=await pool.query("SELECT SUM(amount) amount FROM channel_reserve_treasury_ledger WHERE campaign_id=39 AND entry_type='advance_outflow'");
    assert.equal(money.amount,"0.10000000");
  });
  await t.test("changed views during scan invalidate ranking before payment",async()=>{
    await makeLarge(40,1001);await finishScan(40);
    await pool.query("UPDATE campaign_posts SET views=views+1000,last_views_update=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE id=400000");
    const stale=await runLarge(pool,40,now);
    assert.equal(stale.status,"scan_stale");
    const [[none]]=await pool.query("SELECT COUNT(*) n FROM channel_reserve_treasury_ledger WHERE campaign_id=40 AND entry_type='advance_outflow'");
    assert.equal(none.n,0);
    await pool.query("UPDATE campaign_posts SET last_views_update=UTC_TIMESTAMP(6) WHERE id=400000");
    const next=await runLarge(pool,40,now);assert.equal(next.status,"scanning");
  });
  await t.test("concurrent scheduler calls do not duplicate reserve payout",async()=>{
    await makeLarge(41,1000);
    await Promise.all([schedule(pool,{asOfEpoch:now,batchSize:50}),schedule(pool,{asOfEpoch:now,batchSize:50})]);
    const [[a]]=await pool.query("SELECT COUNT(*) n FROM channel_cpc_reserve_advances WHERE campaign_id=41 AND publisher_id=6");
    assert.equal(a.n,1);
    const [[l]]=await pool.query("SELECT SUM(amount) amount FROM channel_reserve_treasury_ledger WHERE campaign_id=41 AND publisher_id=6 AND entry_type='advance_outflow'");
    assert.equal(l.amount,"0.10000000");
    const [[all]]=await pool.query("SELECT SUM(amount) amount FROM channel_reserve_treasury_ledger WHERE campaign_id=41 AND entry_type='advance_outflow'");
    const [[posts]]=await pool.query("SELECT SUM(allocated_advance) amount FROM channel_cpc_reserve_advance_posts WHERE campaign_id=41");
    assert.equal(all.amount,posts.amount);
  });
  await t.test("scheduler failure is recorded and independent campaign continues",async()=>{
    await makeLarge(42,1000);await makeLarge(43,1000);
    await pool.query("CREATE TRIGGER fail_schedule_credit BEFORE UPDATE ON users FOR EACH ROW IF NEW.id=6 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected_schedule_failure'; END IF");
    const r=await schedule(pool,{asOfEpoch:now,batchSize:50});
    assert.ok(r.outcomes.some(x=>x.status==="failed"&&x.reason.includes("injected_schedule_failure")));
    assert.equal(r.outcomes.at(-1).campaignId,43);
    await pool.query("DROP TRIGGER fail_schedule_credit");
    const retry=await schedule(pool,{asOfEpoch:now+60,batchSize:50});
    assert.ok(retry.outcomes.some(x=>x.campaignId===43&&x.status==="paid"));
  });
  await t.test("mixed BIGINT epoch-ms, legacy 14-digit, DATETIME, NULL and boundary timestamps over >1000 posts under UTC and +03:00 preserve isolation",async()=>{
    await pool.query("ALTER TABLE campaign_posts MODIFY COLUMN last_views_update BIGINT NULL, ADD COLUMN last_views_update_at DATETIME(6) NULL");
    await makeLarge(44,1005);
    await makeLarge(45,10,"0.50000000");
    await finishScan(44);
    // Anchor scan_started_at to exact UTC instant 2026-11-09 05:00:00.000000 (epoch ms 1794200400000, 14-digit 20261109050000)
    await pool.query("UPDATE channel_cpc_priority_scan_state SET scan_started_at='2026-11-09 05:00:00.000000' WHERE campaign_id=44");
    // Seed mixed older, equal-boundary, zero and NULL timestamps across campaign 44 posts
    await pool.query("UPDATE campaign_posts SET last_views_update=NULL,last_views_update_at=NULL WHERE id=440000");
    await pool.query("UPDATE campaign_posts SET last_views_update=0,last_views_update_at=NULL WHERE id=440001");
    await pool.query("UPDATE campaign_posts SET last_views_update=1794200399000,last_views_update_at=NULL WHERE id=440002"); // older 13-digit ms
    await pool.query("UPDATE campaign_posts SET last_views_update=1794200400000,last_views_update_at=NULL WHERE id=440003"); // boundary EQUAL 13-digit ms
    await pool.query("UPDATE campaign_posts SET last_views_update=20261109045959,last_views_update_at=NULL WHERE id=440004"); // older 14-digit legacy
    await pool.query("UPDATE campaign_posts SET last_views_update=20261109050000,last_views_update_at=NULL WHERE id=440005"); // boundary EQUAL 14-digit legacy
    await pool.query("UPDATE campaign_posts SET last_views_update=1794200400,last_views_update_at=NULL WHERE id=440006");     // boundary EQUAL 10-digit s
    await pool.query("UPDATE campaign_posts SET last_views_update=NULL,last_views_update_at='2026-11-09 05:00:00.000000' WHERE id=440007"); // boundary EQUAL DATETIME(6)
    // Newer observation on an UNRELATED campaign (45) must NOT trigger scan_stale on campaign 44
    await pool.query("UPDATE campaign_posts SET last_views_update=1794200999000,last_views_update_at='2026-11-09 05:09:59.000000' WHERE campaign_id=45");

    // Verify under non-UTC session time zone (+03:00) that older/equal/NULL timestamps do NOT falsely restart scan
    const tzConn=await pool.getConnection();
    const singleConnPool={getConnection:async()=>({
      query:(...a)=>tzConn.query(...a),
      beginTransaction:()=>tzConn.beginTransaction(),
      commit:()=>tzConn.commit(),
      rollback:()=>tzConn.rollback(),
      release:()=>{},
    })};
    try{
      await tzConn.query("SET SESSION time_zone = '+03:00'");
      const paidUnderOffset=await runLarge(singleConnPool,44,now);
      assert.equal(paidUnderOffset.status,"paid","Older/equal/NULL timestamps across BIGINT/14-digit/DATETIME must not falsely restart under +03:00");
      assert.equal(paidUnderOffset.publisherId,6);
      assert.equal(paidUnderOffset.credited,"0.10000000");

      // Case A: Newer 13-digit BIGINT epoch-ms (+1ms after scan_started_at) restarts scan before next publisher payment
      await tzConn.query("UPDATE campaign_posts SET last_views_update=1794200400001,last_views_update_at=NULL WHERE id=440002");
      const staleBigint=await runLarge(singleConnPool,44,now);
      assert.equal(staleBigint.status,"scan_stale","Newer 13-digit BIGINT epoch-ms must restart scan");
      assert.equal(staleBigint.credited,"0.00000000");

      // Finish scan of round 2, anchor scan_started_at again, and test Case B: Newer 14-digit legacy timestamp (+1s)
      await finishScan(44);
      await tzConn.query("UPDATE channel_cpc_priority_scan_state SET scan_started_at='2026-11-09 05:00:00.000000' WHERE campaign_id=44");
      await tzConn.query("UPDATE campaign_posts SET last_views_update=NULL,last_views_update_at=NULL WHERE campaign_id=44");
      await tzConn.query("UPDATE campaign_posts SET last_views_update=20261109050001,last_views_update_at=NULL WHERE id=440004");
      const stale14=await runLarge(singleConnPool,44,now);
      assert.equal(stale14.status,"scan_stale","Newer 14-digit legacy timestamp must restart scan under +03:00");
      assert.equal(stale14.credited,"0.00000000");

      // Finish scan of round 3, anchor scan_started_at again, and test Case C: Newer DATETIME(6) last_views_update_at (+1us)
      await finishScan(44);
      await tzConn.query("UPDATE channel_cpc_priority_scan_state SET scan_started_at='2026-11-09 05:00:00.000000' WHERE campaign_id=44");
      await tzConn.query("UPDATE campaign_posts SET last_views_update=NULL,last_views_update_at=NULL WHERE campaign_id=44");
      await tzConn.query("UPDATE campaign_posts SET last_views_update=1794200300000,last_views_update_at='2026-11-09 05:00:00.000001' WHERE id=440007");
      const staleDt=await runLarge(singleConnPool,44,now);
      assert.equal(staleDt.status,"scan_stale","Newer last_views_update_at DATETIME(6) must restart scan");
      assert.equal(staleDt.credited,"0.00000000");
    }finally{
      await tzConn.query("SET SESSION time_zone = '+00:00'").catch(()=>{});
      tzConn.release();
    }
  });
  if(previousSchedulerFlag===undefined)delete process.env.CHANNEL_V101_CPC_PRIORITY_SCHEDULER_ENABLED;
  else process.env.CHANNEL_V101_CPC_PRIORITY_SCHEDULER_ENABLED=previousSchedulerFlag;
 }finally{for(const [key,value] of Object.entries({CHANNEL_V101_CPC_PRIORITY_PAYOUT_ENABLED:old.priority,CHANNEL_V101_UNIFIED_SETTLEMENT_ENABLED:old.unified,CHANNEL_V101_RESERVE_TREASURY_ENABLED:old.reserve})){if(value===undefined)delete process.env[key];else process.env[key]=value}if(pool)await pool.end();if(created)await admin.query("DROP DATABASE "+quote(schema));await admin.end()}
});
