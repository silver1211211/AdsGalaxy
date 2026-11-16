import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import mysql from 'mysql2/promise';

const raw=process.env.ADSGALAXY_ALLOWANCE_TEST_DATABASE_URL;
if(!raw)throw new Error('isolated_allowance_database_url_required');
const url=new URL(raw);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'53307');
assert.equal(url.pathname,'/adsgalaxy_allowance_test');
const cfg={host:url.hostname,port:Number(url.port),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password)};
const schema=`test_phase1_arr_${randomUUID().replaceAll('-','')}`;
const quote=`\`${schema}\``;
function load(path,deps={}){
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,process,require:name=>deps[name]??(()=>{throw new Error(`unexpected_dependency_${name}`)})()},{filename:path});
 return module.exports;
}
const math=load('src/lib/channelAllocationMath.ts');
const policy=load('src/lib/channelPhase1FinancialPolicy.ts',{'@/lib/channelAllocationMath':math});
const ledger=load('src/lib/channelStandardCpcAllowanceLedger.ts',{
 '@/lib/channelAllocationMath':math,'@/lib/channelPhase1FinancialPolicy':policy});
const routing=load('src/lib/channelStandardCpcArrRouting.ts',{
 '@/lib/channelAllocationMath':math,'@/lib/channelPhase1FinancialPolicy':policy,
 '@/lib/channelStandardCpcAllowanceLedger':ledger});
const migration=readFileSync('db/migrations/20261113_1300_standard_cpc_allowance_ledger.sql','utf8');
const req=(clickId,postId,publisherId,grossClickCharge='0.065')=>({campaignId:1,postId,publisherId,clickId,grossClickCharge,
 policy:'standard_cpc_allowance_v1'});

test('new Standard CPC ARR routes through the allowance ledger only',async t=>{
 const admin=await mysql.createConnection(cfg);let pool;
 const previous=process.env.CHANNEL_PHASE1_FINANCIAL_ENABLED;process.env.CHANNEL_PHASE1_FINANCIAL_ENABLED='true';
 try{
  await admin.query(`CREATE DATABASE ${quote}`);pool=mysql.createPool({...cfg,database:schema,connectionLimit:10});
  await pool.query("CREATE TABLE campaigns(id INT PRIMARY KEY,type VARCHAR(20),campaign_kind VARCHAR(30)) ENGINE=InnoDB");
  await pool.query("INSERT INTO campaigns VALUES(1,'clicks','standard')");
  await pool.query("CREATE TABLE users(id INT PRIMARY KEY) ENGINE=InnoDB");await pool.query("INSERT INTO users VALUES(1),(2)");
  await pool.query("CREATE TABLE channels(id INT PRIMARY KEY,user_id INT NOT NULL) ENGINE=InnoDB");
  await pool.query("INSERT INTO channels VALUES(11,1),(12,2)");
  await pool.query("CREATE TABLE campaign_posts(id INT PRIMARY KEY,campaign_id INT NOT NULL,channel_id INT NOT NULL) ENGINE=InnoDB");
  await pool.query("INSERT INTO campaign_posts VALUES(101,1,11),(102,1,12)");
  await pool.query("CREATE TABLE campaign_clicks(id INT PRIMARY KEY,campaign_id INT NOT NULL,post_id INT NOT NULL,is_bot TINYINT NOT NULL,accepted_at DATETIME(6)) ENGINE=InnoDB");
  await pool.query("INSERT INTO campaign_clicks VALUES(1,1,101,0,NOW(6)),(2,1,101,0,NOW(6)),(3,1,101,0,NOW(6)),(4,1,102,0,NOW(6)),(5,1,102,0,NOW(6)),(6,1,102,0,NOW(6)),(7,1,101,0,NOW(6)),(8,1,102,1,NOW(6)),(9,1,102,0,NULL)");
  await pool.query("CREATE TABLE channel_reserve_treasury_ledger(id INT PRIMARY KEY,amount DECIMAL(24,8)) ENGINE=InnoDB");
  await pool.query("INSERT INTO channel_reserve_treasury_ledger VALUES(1,7.00000000)");
  await pool.query(migration);
  const txn=async fn=>{const c=await pool.getConnection();try{await c.beginTransaction();const r=await fn(c);await c.commit();return r}
    catch(e){await c.rollback();throw e}finally{c.release()}};
  const advance=(publisherId,amount,tag)=>ledger.recordStandardCpcAdvance(pool,{campaignId:1,publisherId,amount,
    sourceTransactionKey:`advance:${tag}`,idempotencyKey:`advance-key:${tag}`});
  const reserve=async()=>{const [r]=await pool.query('SELECT CAST(SUM(amount) AS CHAR) amount FROM channel_reserve_treasury_ledger');return r[0].amount};
  await t.test('valid click partially recovers one advance from its 60% share',async()=>{
    const a=await advance(1,'0.10000000','p1-a');assert.ok(a.entryId);
    const r=await txn(c=>routing.routeStandardCpcArrForClickInTransaction(c,req(1,101,1)));
    assert.equal(r.status,'routed');assert.equal(r.recoveredDecimal,'0.03900000');
    assert.equal(r.publisherCashDecimal,'0.00000000');
    assert.equal(math.unitsToDecimal(r.platformUnits),'0.01950000');
    assert.equal(math.unitsToDecimal(r.reserveUnits),'0.00650000');
    assert.equal((await ledger.readStandardCpcAllowanceBalance(pool,1)).outstandingDecimal,'0.06100000');
    assert.equal(await reserve(),'7.00000000');
  });
  await t.test('multiple advances recover deterministically and a click can clear the remainder',async()=>{
    await advance(1,'0.04000000','p1-b');await advance(1,'0.03000000','p1-c');
    const r=await txn(c=>routing.routeStandardCpcArrForClickInTransaction(c,req(2,101,1,'0.20')));
    assert.equal(r.recoveredDecimal,'0.12000000');assert.equal(r.publisherCashDecimal,'0.00000000');
    const [rows]=await pool.query("SELECT amount,applies_to_advance_entry_id FROM channel_standard_cpc_allowance_ledger WHERE source_system='standard_cpc_arr' AND source_transaction_key LIKE 'cpc-click:2:%' ORDER BY applies_to_advance_entry_id");
    assert.deepEqual(rows.map(x=>x.amount),['0.06100000','0.04000000','0.01900000']);
    assert.equal((await ledger.readStandardCpcAllowanceBalance(pool,1)).outstandingDecimal,'0.01100000');
    const cleared=await txn(c=>routing.routeStandardCpcArrForClickInTransaction(c,req(3,101,1)));
    assert.equal(cleared.recoveredDecimal,'0.01100000');assert.equal(cleared.publisherCashDecimal,'0.02800000');
    assert.equal((await ledger.readStandardCpcAllowanceBalance(pool,1)).outstandingDecimal,'0.00000000');
  });
  await t.test('a publisher with no advance keeps the full click share',async()=>{
    const r=await txn(c=>routing.routeStandardCpcArrForClickInTransaction(c,req(7,101,1)));
    assert.equal(r.recoveredDecimal,'0.00000000');assert.equal(r.publisherCashDecimal,'0.03900000');
  });
  await t.test('another publisher is isolated and duplicate ARR does not recover twice',async()=>{
    await advance(2,'0.05000000','p2-a');
    const first=await txn(c=>routing.routeStandardCpcArrForClickInTransaction(c,req(4,102,2,'0.10')));
    assert.equal(first.recoveredDecimal,'0.05000000');assert.equal(first.publisherCashDecimal,'0.01000000');
    const duplicate=await txn(c=>routing.routeStandardCpcArrForClickInTransaction(c,req(4,102,2,'0.10')));
    assert.equal(duplicate.status,'duplicate');assert.equal(duplicate.recoveredDecimal,'0.05000000');
    assert.equal((await ledger.readStandardCpcAllowanceBalance(pool,1)).outstandingDecimal,'0.00000000');
    assert.equal(await reserve(),'7.00000000');
  });
  await t.test('concurrent recovery attempts post once',async()=>{
    await advance(2,'0.10000000','p2-b');
    const results=await Promise.all([txn(c=>routing.routeStandardCpcArrForClickInTransaction(c,req(5,102,2))),
      txn(c=>routing.routeStandardCpcArrForClickInTransaction(c,req(5,102,2)))]);
    assert.deepEqual(results.map(x=>x.status).sort(),['duplicate','routed']);
    const [rows]=await pool.query("SELECT COUNT(*) n FROM channel_standard_cpc_allowance_ledger WHERE source_transaction_key LIKE 'cpc-click:5:%'");
    assert.equal(rows[0].n,1);
  });
  await t.test('recovery reversal restores outstanding capacity usage, never reserve',async()=>{
    const [rows]=await pool.query("SELECT id,publisher_id,amount FROM channel_standard_cpc_allowance_ledger WHERE source_transaction_key LIKE 'cpc-click:5:%'");
    const r=rows[0];const before=await ledger.readStandardCpcAllowanceBalance(pool,1);
    await ledger.reverseStandardCpcAllowanceEntry(pool,{campaignId:1,publisherId:r.publisher_id,
      amount:r.amount,originalEntryId:r.id,sourceTransactionKey:'reverse:click:5',idempotencyKey:'reverse:click:5'});
    const after=await ledger.readStandardCpcAllowanceBalance(pool,1);
    assert.equal(after.outstandingUnits-before.outstandingUnits,math.decimalToUnits(r.amount));
    assert.equal(await reserve(),'7.00000000');
  });
  await t.test('invalid clicks and wrong publisher fail without ledger change',async()=>{
    for(const input of [req(8,102,2),req(9,102,2),req(6,102,1)])
      await assert.rejects(txn(c=>routing.routeStandardCpcArrForClickInTransaction(c,input)),/arr_click_not_accepted_for_publisher/);
  });
  await t.test('legacy policy and disabled new flag leave legacy reserve untouched',async()=>{
    assert.equal((await txn(c=>routing.routeStandardCpcArrForClickInTransaction(c,{...req(6,102,2),policy:'legacy'}))).status,'legacy_passthrough');
    process.env.CHANNEL_PHASE1_FINANCIAL_ENABLED='false';
    assert.equal((await txn(c=>routing.routeStandardCpcArrForClickInTransaction(c,req(6,102,2)))).status,'legacy_passthrough');
    process.env.CHANNEL_PHASE1_FINANCIAL_ENABLED='true';assert.equal(await reserve(),'7.00000000');
  });
  await t.test('click transaction failure rolls allowance recovery back',async()=>{
    const before=await ledger.readStandardCpcAllowanceBalance(pool,1);
    await assert.rejects(txn(async c=>{await routing.routeStandardCpcArrForClickInTransaction(c,req(6,102,2));
      throw new Error('simulated_click_settlement_failure')}),/simulated_click_settlement_failure/);
    assert.equal((await ledger.readStandardCpcAllowanceBalance(pool,1)).outstandingDecimal,before.outstandingDecimal);
    const [rows]=await pool.query("SELECT COUNT(*) n FROM channel_standard_cpc_allowance_ledger WHERE source_transaction_key LIKE 'cpc-click:6:%'");
    assert.equal(rows[0].n,0);assert.equal(await reserve(),'7.00000000');
  });
 }finally{
  if(previous===undefined)delete process.env.CHANNEL_PHASE1_FINANCIAL_ENABLED;else process.env.CHANNEL_PHASE1_FINANCIAL_ENABLED=previous;
  if(pool)await pool.end();await admin.query(`DROP DATABASE IF EXISTS ${quote}`);await admin.end();
 }
});
