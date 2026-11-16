import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {test} from "node:test";
import mysql from "mysql2/promise";
import ts from "typescript";

const schema=`test_smart_fund_${randomUUID().replaceAll("-","")}`;
const cfg={host:"127.0.0.1",port:53307,user:"root",multipleStatements:true};
function load(path,deps={}){const js=ts.transpileModule(readFileSync(path,"utf8"),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};new Function("module","exports","require","process",js)(mod,mod.exports,
    name=>deps[name]??{},process);return mod.exports;}
function migrate(file){const r=spawnSync("/usr/bin/mariadb",["--no-defaults","-h","127.0.0.1","-P","53307","-u","root",schema],
  {input:readFileSync(file,"utf8"),encoding:"utf8"});assert.equal(r.status,0,r.stderr);}
const math=load("src/lib/channelAllocationMath.ts");
const treasury=load("src/lib/channelReserveTreasury.ts",{"@/lib/channelAllocationMath":math});
let failCredit=false;
const service=load("src/lib/channelSmartReachReserveFunding.ts",{
  "@/lib/channelAllocationMath":math,"@/lib/channelSmartReachConfiguration":{SMART_REACH_POLICY_VERSION:"adsgalaxy-smart-reach-v1"},
  "@/lib/channelUnifiedSettlement":{acquireSharedReserveTreasuryLock:async conn=>{
    const [rows]=await conn.query("SELECT id FROM channel_reserve_treasury_control WHERE id=1 FOR UPDATE");return rows.length===1;}},
  "@/lib/channelReserveTreasury":treasury,
  "@/lib/earnings":{creditSettledPublisherBalance:async(conn,id,amount,source)=>{
    if(failCredit)throw new Error("simulated_publisher_credit_failure");
    const [change]=await conn.query("UPDATE users SET balance_available=balance_available+? WHERE id=?",[amount,id]);
    if(!change.affectedRows)return false;
    await conn.query("INSERT INTO publisher_balance_events(source_key,publisher_id,amount) VALUES(?,?,?)",
      [source.sourceKey,id,amount]);return true;
  }}});
async function value(db,sql,args=[]){const [rows]=await db.query(sql,args);return rows[0];}

test("Smart Reach reserve claims use one shared treasury and atomic exact funding",async t=>{
  const admin=await mysql.createConnection(cfg);let db;const old=process.env.CHANNEL_SMART_REACH_RESERVE_FUNDING_ENABLED;
  try{
    await admin.query(`CREATE DATABASE \`${schema}\``);db=mysql.createPool({...cfg,database:schema,connectionLimit:5});
    await db.query(`CREATE TABLE campaigns(id INT PRIMARY KEY,financial_policy_version VARCHAR(80),
      financial_billing_mode VARCHAR(40),status VARCHAR(30)) ENGINE=InnoDB`);
    await db.query("CREATE TABLE users(id INT PRIMARY KEY,balance_available DECIMAL(24,8) DEFAULT 0) ENGINE=InnoDB");
    await db.query("CREATE TABLE channel_reserve_treasury_control(id INT PRIMARY KEY) ENGINE=InnoDB");
    await db.query(`CREATE TABLE channel_reserve_treasury_ledger(id BIGINT UNSIGNED PRIMARY KEY,campaign_id INT,
      entry_type ENUM('allocation_inflow','authorized_funding','advance_outflow','recovery_inflow','quality_bonus_outflow','reversal','adjustment') NOT NULL,
      direction ENUM('in','out') NOT NULL,amount DECIMAL(24,8),idempotency_key VARCHAR(191),policy_version VARCHAR(80)) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE channel_smart_reach_publisher_accounts(campaign_id INT,publisher_id INT,
      entitled_amount DECIMAL(24,8),funded_amount DECIMAL(24,8),pending_amount DECIMAL(24,8),
      PRIMARY KEY(campaign_id,publisher_id)) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE channel_smart_reach_view_claims(id BIGINT UNSIGNED PRIMARY KEY,campaign_id INT,
      publisher_id INT,entitled_amount DECIMAL(24,8),funded_amount DECIMAL(24,8),pending_amount DECIMAL(24,8),
      last_funded_at DATETIME(6),UNIQUE KEY uq_smart_claim_funding_identity(id,campaign_id,publisher_id)) ENGINE=InnoDB`);
    await db.query("CREATE TABLE channel_smart_reach_funding_allocations(claim_id BIGINT UNSIGNED,amount DECIMAL(24,8)) ENGINE=InnoDB");
    await db.query("CREATE TABLE publisher_balance_events(source_key VARCHAR(191) PRIMARY KEY,publisher_id INT,amount DECIMAL(24,8)) ENGINE=InnoDB");
    await db.query("INSERT INTO campaigns VALUES(1,'adsgalaxy-smart-reach-v1','smart_reach','active')");
    await db.query("INSERT INTO users VALUES(10,0),(11,0)");
    await db.query("INSERT INTO channel_reserve_treasury_control VALUES(1)");
    await db.query(`INSERT INTO channel_reserve_treasury_ledger VALUES
      (1,1,'allocation_inflow','in',0.10000000,'v101:reserve_alloc:clk_1','adsgalaxy-smart-reach-v1')`);
    await db.query("INSERT INTO channel_smart_reach_publisher_accounts VALUES(1,10,0.05000000,0,0.05000000),(1,11,0.05000000,0,0.05000000)");
    await db.query("INSERT INTO channel_smart_reach_view_claims VALUES(101,1,10,0.05000000,0,0.05000000,NULL),(102,1,11,0.05000000,0,0.05000000,NULL)");
    migrate("db/migrations/20261114_1000_smart_reach_reserve_funding.sql");
    process.env.CHANNEL_SMART_REACH_RESERVE_FUNDING_ENABLED="true";
    await t.test("two concurrent publishers cannot exceed 70% shared spendable reserve",async()=>{
      const results=await Promise.all([
        service.fundPendingSmartReachClaimsFromReserve(db,1,10),
        service.fundPendingSmartReachClaimsFromReserve(db,1,11)]);
      const total=results.reduce((s,r)=>s+math.decimalToUnits(r.creditedDecimal),0n);
      assert.equal(math.unitsToDecimal(total),"0.07000000");
      assert.equal((await value(db,"SELECT SUM(committed_amount) amount FROM channel_smart_reach_reserve_fundings")).amount,"0.07000000");
      assert.equal((await value(db,"SELECT SUM(balance_available) amount FROM users")).amount,"0.07000000");
      assert.equal(treasury.getReserveTreasuryBalance!==undefined,true);
      const state=await treasury.getReserveTreasuryBalance(db);
      assert.equal(state.unencumberedSpendableBalanceDecimal,"0.00000000");
    });
    await t.test("retry is idempotent and unfunded remainder stays pending",async()=>{
      await service.fundPendingSmartReachClaimsFromReserve(db,1,10);
      await service.fundPendingSmartReachClaimsFromReserve(db,1,11);
      assert.equal((await value(db,"SELECT SUM(pending_amount) amount FROM channel_smart_reach_view_claims")).amount,"0.03000000");
      assert.equal((await value(db,"SELECT COUNT(*) n FROM publisher_balance_events")).n,2);
    });
    await t.test("failed publisher credit rolls back reserve commitment and allocation",async()=>{
      await db.query(`INSERT INTO channel_reserve_treasury_ledger VALUES
        (2,1,'allocation_inflow','in',0.10000000,'v101:reserve_alloc:clk_2','adsgalaxy-smart-reach-v1')`);
      const before=(await value(db,"SELECT COUNT(*) n FROM channel_smart_reach_reserve_fundings")).n;
      failCredit=true;
      await assert.rejects(service.fundPendingSmartReachClaimsFromReserve(db,1,11),/simulated_publisher_credit_failure/);
      failCredit=false;
      assert.equal((await value(db,"SELECT COUNT(*) n FROM channel_smart_reach_reserve_fundings")).n,before);
      assert.equal((await value(db,"SELECT COUNT(*) n FROM channel_smart_reach_reserve_allocations")).n,before);
      const retry=await service.fundPendingSmartReachClaimsFromReserve(db,1,11);
      assert.equal(retry.status,"funded");
    });
    await t.test("disabled flag cannot credit a publisher",async()=>{
      delete process.env.CHANNEL_SMART_REACH_RESERVE_FUNDING_ENABLED;
      assert.equal((await service.fundPendingSmartReachClaimsFromReserve(db,1,10)).status,"disabled");
    });
  }finally{old===undefined?delete process.env.CHANNEL_SMART_REACH_RESERVE_FUNDING_ENABLED:
    process.env.CHANNEL_SMART_REACH_RESERVE_FUNDING_ENABLED=old;
    if(db)await db.end();await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);await admin.end();}
});
