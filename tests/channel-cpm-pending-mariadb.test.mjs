import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config({ path: ".env", quiet: true });
const source=fs.readFileSync("src/lib/channelCpmPendingSettlement.ts","utf8");
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};new Function("module","exports",js)(mod,mod.exports);
const {recordPendingCpmAllocation:record,listPendingCpmAllocations:list,cpmWindowForEvent:windowFor}=mod.exports;
const schema="test_cpm_pending_codex_"+Date.now();
const quote=n=>"\u0060"+n+"\u0060";

test("disposable MariaDB pending CPM settlement foundation", async t=>{
  const opts={host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASS};
  const admin=await mysql.createConnection({...opts,database:process.env.DB_NAME});let pool;let created=false;
  const req=(sourceKey,campaignId=10,publisherId=2,neutralEntitlement="0.60000000")=>({sourceKey,campaignId,publisherId,neutralEntitlement});
  try {
    assert.match(schema,/^test_cpm_pending_codex_\d+$/);await admin.query("CREATE DATABASE "+quote(schema));created=true;
    pool=mysql.createPool({...opts,database:schema,connectionLimit:5,decimalNumbers:false});
    const ddl=[
      "CREATE TABLE users (id BIGINT PRIMARY KEY,ad_balance DECIMAL(20,8),balance_available DECIMAL(20,8)) ENGINE=InnoDB",
      "CREATE TABLE campaigns (id BIGINT PRIMARY KEY,user_id BIGINT,type VARCHAR(20)) ENGINE=InnoDB",
      "CREATE TABLE channels (id BIGINT PRIMARY KEY,user_id BIGINT) ENGINE=InnoDB",
      "CREATE TABLE campaign_posts (id BIGINT PRIMARY KEY,campaign_id BIGINT,channel_id BIGINT) ENGINE=InnoDB",
      "CREATE TABLE channel_unified_settlement_events (id BIGINT AUTO_INCREMENT PRIMARY KEY,idempotency_key VARCHAR(191) UNIQUE,campaign_id BIGINT,advertiser_id BIGINT,publisher_id BIGINT,channel_id BIGINT,post_id BIGINT,units BIGINT,unit_price DECIMAL(20,8),advertiser_debit DECIMAL(20,8),publisher_credit DECIMAL(20,8),platform_revenue DECIMAL(20,8),reserve_contribution DECIMAL(20,8),settlement_type VARCHAR(32),status VARCHAR(32),created_at DATETIME(6)) ENGINE=InnoDB",
      "CREATE TABLE channel_advertiser_debits (source_key VARCHAR(191) PRIMARY KEY,settlement_type VARCHAR(20),publisher_status VARCHAR(20),publisher_settled_at DATETIME NULL,campaign_id BIGINT,post_id BIGINT,channel_id BIGINT,publisher_id BIGINT,advertiser_debit DECIMAL(20,8),publisher_credit DECIMAL(20,8),units BIGINT,unit_price DECIMAL(20,8)) ENGINE=InnoDB",
      "CREATE TABLE advertiser_direct_debits (source_key VARCHAR(255) PRIMARY KEY,status VARCHAR(20),campaign_table VARCHAR(32),billing_type VARCHAR(32),advertiser_id BIGINT,campaign_id BIGINT,amount DECIMAL(20,8)) ENGINE=InnoDB",
      "CREATE TABLE financial_sentinel (platform DECIMAL(20,8),reserve_amount DECIMAL(20,8)) ENGINE=InnoDB"
    ];
    for(const q of ddl)await pool.query(q);
    const migration=fs.readFileSync("db/migrations/20261102_1200_channel_cpm_pending.sql","utf8");
    for(const q of migration.split(";").map(x=>x.trim()).filter(Boolean))await pool.query(q);
    for(const q of migration.split(";").map(x=>x.trim()).filter(Boolean))await pool.query(q);
    await pool.query("INSERT INTO users VALUES (1,10,0),(2,0,5),(3,0,4)");
    await pool.query("INSERT INTO campaigns VALUES (10,1,'views'),(11,1,'views')");
    await pool.query("INSERT INTO channels VALUES (20,2),(21,3)");
    await pool.query("INSERT INTO campaign_posts VALUES (100,10,20),(101,10,21),(102,11,20)");
    await pool.query("INSERT INTO financial_sentinel VALUES (0.3,0.1)");
    async function fixture(key,campaign=10,publisher=2,channel=20,post=100,when="2026-11-02 10:00:00.000000",status="funded_pending") {
      await pool.query("INSERT INTO channel_unified_settlement_events (idempotency_key,campaign_id,advertiser_id,publisher_id,channel_id,post_id,units,unit_price,advertiser_debit,publisher_credit,platform_revenue,reserve_contribution,settlement_type,status,created_at) VALUES (?,?,1,?,?,?,100,'10.00000000','1.00000000','0.60000000','0.30000000','0.10000000','cpm_view',?,?)",[key,campaign,publisher,channel,post,status,when]);
      await pool.query("INSERT INTO channel_advertiser_debits VALUES (?,'view','window_pending',NULL,?,?,?,?,1,0.6,100,10)",[key,campaign,post,channel,publisher]);
      await pool.query("INSERT INTO advertiser_direct_debits VALUES (?,'settled','campaigns','channel_view',1,?,1)",["channel:"+key,campaign]);
    }
    async function transaction(fn) {const c=await pool.getConnection();try{await c.beginTransaction();const x=await fn(c);await c.commit();return x}catch(e){await c.rollback();throw e}finally{c.release()}}
    await fixture('one');
    let first;
    await t.test('boundary rules and valid pending allocation',async()=>{assert.deepEqual(windowFor(10,7199),{campaignId:10,startEpoch:3600,endEpoch:7200,finalizableEpoch:8100});assert.equal(windowFor(10,7200).startEpoch,7200);first=await transaction(c=>record(c,req('one')));assert.equal(first.duplicate,false)});
    await t.test('identical retry and conflicting duplicate',async()=>{const r=await transaction(c=>record(c,req('one')));assert.equal(r.id,first.id);assert.equal(r.duplicate,true);await assert.rejects(transaction(c=>record(c,req('one',10,2,'0.60000001'))),/conflicting_payload/)});
    await t.test('multiple publishers and distinct campaign windows',async()=>{await fixture('two',10,3,21,101);await fixture('three',11,2,20,102);const a=await transaction(c=>record(c,req('two',10,3)));const b=await transaction(c=>record(c,req('three',11,2)));assert.equal(a.windowId,first.windowId);assert.notEqual(b.windowId,first.windowId);const c=await pool.getConnection();try{const r=await list(c,10,first.windowId);assert.deepEqual(r.map(x=>Number(x.publisher_id)),[2,3]);assert.equal(r[0].neutral_entitlement,'0.60000000')}finally{c.release()}});
    await t.test('unfunded, paid, wrong owner, and no transaction fail closed',async()=>{await assert.rejects(transaction(c=>record(c,req('missing'))),/unfunded/);await fixture('paid',10,2,20,100,'2026-11-02 10:00:00','settled');await assert.rejects(transaction(c=>record(c,req('paid'))),/finalized/);await assert.rejects(transaction(c=>record(c,req('one',11,2))),/conflicting/);const c=await pool.getConnection();try{await assert.rejects(record(c,req('one')),/transaction_required/)}finally{c.release()}});
    await t.test('eight-decimal precision and stable window policy',async()=>{await fixture('precision');await pool.query("UPDATE channel_unified_settlement_events SET advertiser_debit=1.00000001,publisher_credit=0.60000001 WHERE idempotency_key='precision'");await pool.query("UPDATE channel_advertiser_debits SET advertiser_debit=1.00000001,publisher_credit=0.60000001 WHERE source_key='precision'");await pool.query("UPDATE advertiser_direct_debits SET amount=1.00000001 WHERE source_key='channel:precision'");const r=await transaction(c=>record(c,req('precision',10,2,'0.60000001')));const [[saved]]=await pool.query("SELECT neutral_entitlement FROM channel_cpm_pending_allocations WHERE id=?",[r.id]);assert.equal(saved.neutral_entitlement,'0.60000001');await assert.rejects(transaction(c=>record(c,{...req('precision',10,2,'0.60000001'),policy:{windowSeconds:7200,graceSeconds:900}})),/policy_conflict/)});
    await t.test('rollback discards pending record',async()=>{await fixture('rollback');const c=await pool.getConnection();try{await c.beginTransaction();await record(c,req('rollback'));await c.rollback()}finally{c.release()}const [[r]]=await pool.query("SELECT COUNT(*) n FROM channel_cpm_pending_allocations WHERE source_key='rollback'");assert.equal(r.n,0)});
    await t.test('parallel retries create one liability',async()=>{await fixture('race');const r=await Promise.all([transaction(c=>record(c,req('race'))),transaction(c=>record(c,req('race')))]);assert.deepEqual(r.map(x=>x.duplicate).sort(),[false,true]);const [[n]]=await pool.query("SELECT COUNT(*) n FROM channel_cpm_pending_allocations WHERE source_key='race'");assert.equal(n.n,1)});
    await t.test('one post belongs to separate UTC windows across midnight and month end',async()=>{
      const observations=[
        ['oct-last','2026-10-31 23:59:00.000000'],
        ['nov-midnight','2026-11-01 00:00:00.000000'],
        ['nov-one-minute','2026-11-01 00:01:00.000000'],
        ['nov-next-day','2026-11-02 00:01:00.000000'],
      ];
      const windows=[];
      for(const [key,when] of observations){
        await fixture(key,10,2,20,100,when);
        windows.push(await transaction(c=>record(c,req(key))));
      }
      assert.notEqual(windows[0].windowId,windows[1].windowId);
      assert.equal(windows[1].windowId,windows[2].windowId);
      assert.notEqual(windows[2].windowId,windows[3].windowId);
      const [rows]=await pool.query("SELECT p.source_key,p.post_id,w.start_epoch,w.end_epoch,p.event_epoch FROM channel_cpm_pending_allocations p JOIN channel_cpm_settlement_windows w ON w.id=p.window_id WHERE p.source_key IN ('oct-last','nov-midnight','nov-one-minute','nov-next-day') ORDER BY p.event_epoch");
      assert.equal(rows.length,4);assert.ok(rows.every(r=>r.post_id===100&&r.event_epoch>=r.start_epoch&&r.event_epoch<r.end_epoch));
      assert.equal(windowFor(10,Date.parse('2026-10-31T23:59:00Z')/1000).startEpoch,Date.parse('2026-10-31T23:00:00Z')/1000);
      assert.equal(windowFor(10,Date.parse('2026-11-01T00:00:00Z')/1000).startEpoch,Date.parse('2026-11-01T00:00:00Z')/1000);
      assert.equal(windowFor(10,Date.parse('2026-11-01T00:01:00Z')/1000).startEpoch,Date.parse('2026-11-01T00:00:00Z')/1000);
    });
    await t.test('balances platform and reserve unchanged',async()=>{const [u]=await pool.query('SELECT * FROM users ORDER BY id');const [[f]]=await pool.query('SELECT * FROM financial_sentinel');assert.deepEqual(u.map(x=>[x.ad_balance,x.balance_available]),[['10.00000000','0.00000000'],['0.00000000','5.00000000'],['0.00000000','4.00000000']]);assert.equal(f.platform,'0.30000000');assert.equal(f.reserve_amount,'0.10000000')});
  } finally {if(pool)await pool.end();if(created)await admin.query("DROP DATABASE "+quote(schema));await admin.end()}
});
