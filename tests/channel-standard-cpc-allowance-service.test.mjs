import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import mysql from 'mysql2/promise';

const raw=process.env.ADSGALAXY_ALLOWANCE_TEST_DATABASE_URL;
if(!raw)throw new Error('isolated_allowance_database_url_required');
const url=new URL(raw);
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'53307');
assert.equal(url.pathname,'/adsgalaxy_allowance_test');
const config={host:url.hostname,port:Number(url.port),user:decodeURIComponent(url.username),
  password:decodeURIComponent(url.password)};
const schema=`test_phase1_service_${randomUUID().replaceAll('-','')}`;
const quote=`\`${schema}\``;
function load(path,deps={}){
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{
    module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,process,
    require:name=>deps[name]??(()=>{throw new Error(`unexpected_dependency_${name}`)})()},
    {filename:path});
  return module.exports;
}
const math=load('src/lib/channelAllocationMath.ts');
const policy=load('src/lib/channelPhase1FinancialPolicy.ts',{'@/lib/channelAllocationMath':math});
const service=load('src/lib/channelStandardCpcAllowanceLedger.ts',{
  '@/lib/channelAllocationMath':math,'@/lib/channelPhase1FinancialPolicy':policy});
const migration=readFileSync('db/migrations/20261113_1300_standard_cpc_allowance_ledger.sql','utf8');
const table='channel_standard_cpc_allowance_ledger';
const request=(campaignId,amount,tag,publisherId=1)=>({campaignId,publisherId,amount,sourceTransactionKey:`source:${tag}`,idempotencyKey:`key:${tag}`});

test('Standard CPC allowance service uses atomic campaign locks',async t=>{
  const admin=await mysql.createConnection(config);
  let pool;
  const previous=process.env.CHANNEL_PHASE1_FINANCIAL_ENABLED;
  process.env.CHANNEL_PHASE1_FINANCIAL_ENABLED='true';
  try{
    await admin.query(`CREATE DATABASE ${quote}`);
    pool=mysql.createPool({...config,database:schema,connectionLimit:8});
    await pool.query("SET SESSION sql_mode='STRICT_ALL_TABLES'");
    await pool.query("CREATE TABLE campaigns(id INT NOT NULL PRIMARY KEY,type VARCHAR(20),campaign_kind VARCHAR(30)) ENGINE=InnoDB");
    await pool.query("INSERT INTO campaigns VALUES (1,'clicks','standard'),(2,'clicks','standard'),(3,'views','standard'),(4,'clicks','channel_growth'),(5,'clicks','standard')");
    await pool.query("CREATE TABLE users(id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB");
    await pool.query("INSERT INTO users(id) VALUES (1),(2)");
    await pool.query(migration);
    await t.test('advance/recovery revolve up to exactly five dollars',async()=>{
      assert.equal((await service.readStandardCpcAllowanceBalance(pool,1)).capacityDecimal,'5.00000000');
      const a1=await service.recordStandardCpcAdvance(pool,request(1,'3','a1'));
      assert.equal(a1.outstandingDecimal,'3.00000000');
      assert.equal((await service.recordStandardCpcRecovery(pool,{...request(1,'1','r1'),advanceEntryId:a1.entryId})).outstandingDecimal,'2.00000000');
      assert.equal((await service.recordStandardCpcAdvance(pool,request(1,'3','a2'))).outstandingDecimal,'5.00000000');
      await assert.rejects(service.recordStandardCpcAdvance(pool,request(1,'0.00000001','overflow')),/standard_cpc_allowance_exhausted/);
      await assert.rejects(service.recordStandardCpcRecovery(pool,{...request(1,'3','wrong-advance'),advanceEntryId:a1.entryId}),/recovery_exceeds_target_advance/);
      assert.equal((await service.readStandardCpcAllowanceBalance(pool,2)).capacityDecimal,'5.00000000');
    });
    await t.test('exact duplicate is harmless; changed parameters and source reuse fail',async()=>{
      const duplicate=await service.recordStandardCpcAdvance(pool,request(1,'3.00000000','a1'));
      assert.equal(duplicate.status,'duplicate');assert.equal(duplicate.outstandingDecimal,'5.00000000');
      await assert.rejects(service.recordStandardCpcAdvance(pool,{...request(1,'2','a1')}),/allowance_idempotency_conflict/);
      const [a1]=await pool.query(`SELECT id FROM ${table} WHERE idempotency_key='key:a1'`);
      await assert.rejects(service.recordStandardCpcRecovery(pool,{...request(1,'1','r1'),amount:'0.5',advanceEntryId:a1[0].id}),/allowance_idempotency_conflict/);
      await assert.rejects(service.recordStandardCpcAdvance(pool,{...request(2,'1','a1'),idempotencyKey:'different:key'}));
    });
    await t.test('invalid campaign kinds, precision and disabled flag fail closed',async()=>{
      await assert.rejects(service.recordStandardCpcAdvance(pool,request(3,'1','cpm')),/allowance_requires_standard_cpc_campaign/);
      await assert.rejects(service.recordStandardCpcAdvance(pool,request(4,'1','growth')),/allowance_requires_standard_cpc_campaign/);
      await assert.rejects(service.recordStandardCpcAdvance(pool,request(2,'0.000000001','precision')),/exact_8_decimal/);
      process.env.CHANNEL_PHASE1_FINANCIAL_ENABLED='false';
      await assert.rejects(service.recordStandardCpcAdvance(pool,request(2,'1','off')),/phase1_allowance_disabled/);
      process.env.CHANNEL_PHASE1_FINANCIAL_ENABLED='true';
    });
    await t.test('partial reversals cannot overrun original, balance, or cap',async()=>{
      const [rows]=await pool.query(`SELECT id,idempotency_key FROM ${table} WHERE campaign_id=1`);
      const a1=rows.find(x=>x.idempotency_key==='key:a1').id;
      const r1=rows.find(x=>x.idempotency_key==='key:r1').id;
      await assert.rejects(service.reverseStandardCpcAllowanceEntry(pool,{...request(1,'1','rev-r-full'),originalEntryId:r1}),/recovery_reversal_exceeds_allowance_limit/);
      await assert.rejects(service.reverseStandardCpcAllowanceEntry(pool,{...request(2,'1','rev-cross'),originalEntryId:a1}),/invalid_allowance_reversal_target/);
      assert.equal((await service.reverseStandardCpcAllowanceEntry(pool,{...request(1,'2','rev-a-part'),originalEntryId:a1})).outstandingDecimal,'3.00000000');
      await assert.rejects(service.reverseStandardCpcAllowanceEntry(pool,{...request(1,'2','rev-a-over'),originalEntryId:a1}),/allowance_reversal_exceeds_original/);
      assert.equal((await service.reverseStandardCpcAllowanceEntry(pool,{...request(1,'0.4','rev-r-1'),originalEntryId:r1})).outstandingDecimal,'3.40000000');
      assert.equal((await service.reverseStandardCpcAllowanceEntry(pool,{...request(1,'0.6','rev-r-2'),originalEntryId:r1})).outstandingDecimal,'4.00000000');
      await assert.rejects(service.recordStandardCpcRecovery(pool,{...request(1,'5','overrecover'),advanceEntryId:a1}),/recovery_exceeds_outstanding_advance/);
      await assert.rejects(service.reverseStandardCpcAllowanceEntry(pool,{...request(1,'0.00000001','rev-r-over'),originalEntryId:r1}),/allowance_reversal_exceeds_original/);
      const duplicate=await service.reverseStandardCpcAllowanceEntry(pool,{...request(1,'0.4','rev-r-1'),originalEntryId:r1});
      assert.equal(duplicate.status,'duplicate');
    });
    await t.test('a previously recovered advance can reverse only its eligible remainder',async()=>{
      const a=await service.recordStandardCpcAdvance(pool,request(2,'3','a3'));
      await service.recordStandardCpcRecovery(pool,{...request(2,'1','r2'),advanceEntryId:a.entryId});
      const partial=await service.reverseStandardCpcAllowanceEntry(pool,{...request(2,'2','rev-a3'),originalEntryId:a.entryId});
      assert.equal(partial.outstandingDecimal,'0.00000000');
      await assert.rejects(service.reverseStandardCpcAllowanceEntry(pool,{...request(2,'1','rev-a3-rest'),originalEntryId:a.entryId}),/advance_reversal_exceeds_unrecovered_amount/);
    });
    await t.test('one publisher cannot recover or reverse another publisher advance',async()=>{
      const other=await service.recordStandardCpcAdvance(pool,request(1,'0.5','publisher-two',2));
      await assert.rejects(service.recordStandardCpcRecovery(pool,{
        ...request(1,'0.1','wrong-publisher',1),advanceEntryId:other.entryId}),/invalid_allowance_advance_target/);
      await assert.rejects(service.reverseStandardCpcAllowanceEntry(pool,{
        ...request(1,'0.1','wrong-reversal',1),originalEntryId:other.entryId}),/invalid_allowance_reversal_target/);
      assert.equal((await service.recordStandardCpcRecovery(pool,{
        ...request(1,'0.1','right-publisher',2),advanceEntryId:other.entryId})).status,'recorded');
    });
    await t.test('two concurrent advances serialize on an empty campaign ledger',async()=>{
      const [before]=await pool.query(`SELECT COUNT(*) n FROM ${table} WHERE campaign_id=5`);
      assert.equal(before[0].n,0);
      const results=await Promise.allSettled([
        service.recordStandardCpcAdvance(pool,request(5,'3','race-1')),
        service.recordStandardCpcAdvance(pool,request(5,'3','race-2'))]);
      assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
      assert.equal(results.filter(x=>x.status==='rejected').length,1);
      assert.equal((await service.readStandardCpcAllowanceBalance(pool,5)).outstandingDecimal,'3.00000000');
    });
    await t.test('failure after insert rolls the whole transaction back',async()=>{
      const before=await service.readStandardCpcAllowanceBalance(pool,5);
      const failingDb={getConnection:async()=>{
        const real=await pool.getConnection();
        return {beginTransaction:real.beginTransaction.bind(real),query:real.query.bind(real),
          commit:async()=>{throw new Error('simulated_commit_failure')},
          rollback:real.rollback.bind(real),release:real.release.bind(real)};
      }};
      await assert.rejects(service.recordStandardCpcAdvance(failingDb,request(5,'1','rollback')),/simulated_commit_failure/);
      const [rows]=await pool.query(`SELECT COUNT(*) n FROM ${table} WHERE idempotency_key='key:rollback'`);
      assert.equal(rows[0].n,0);
      assert.equal((await service.readStandardCpcAllowanceBalance(pool,5)).outstandingDecimal,before.outstandingDecimal);
    });
    await t.test('only the allowance table gained records',async()=>{
      const [rows]=await pool.query(`SELECT COUNT(*) n FROM ${table}`);assert.ok(rows[0].n>0);
      const [tables]=await pool.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()`);
      assert.deepEqual(tables.map(x=>x.TABLE_NAME).sort(),['campaigns','users',table].sort());
    });
  }finally{
    if(previous===undefined)delete process.env.CHANNEL_PHASE1_FINANCIAL_ENABLED;
    else process.env.CHANNEL_PHASE1_FINANCIAL_ENABLED=previous;
    if(pool)await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS ${quote}`);
    await admin.end();
  }
});
