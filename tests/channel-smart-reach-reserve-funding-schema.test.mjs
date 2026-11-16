import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {test} from "node:test";
import mysql from "mysql2/promise";

const schema=`test_smart_reserve_${randomUUID().replaceAll("-","")}`;
const config={host:"127.0.0.1",port:53307,user:"root",multipleStatements:true};
function migration(file,expectedSuccess=true){
  const result=spawnSync("/usr/bin/mariadb",["--no-defaults","-h","127.0.0.1","-P","53307","-u","root",schema],
    {input:readFileSync(file,"utf8"),encoding:"utf8"});
  assert.equal(result.status===0,expectedSuccess,result.stderr);
  return result;
}
async function row(db,sql,args=[]){const [rows]=await db.query(sql,args);return rows[0];}

test("Smart Reach reserve funding schema attributes only collected same-campaign reserve and guards rollback",async t=>{
  const admin=await mysql.createConnection(config);let db;
  try{
    await admin.query(`CREATE DATABASE \`${schema}\``);
    db=mysql.createPool({...config,database:schema,connectionLimit:4});
    await db.query("CREATE TABLE campaigns(id INT PRIMARY KEY) ENGINE=InnoDB");
    await db.query("CREATE TABLE users(id INT PRIMARY KEY) ENGINE=InnoDB");
    await db.query("CREATE TABLE campaign_posts(id INT PRIMARY KEY) ENGINE=InnoDB");
    await db.query(`CREATE TABLE channel_smart_reach_view_claims(id BIGINT UNSIGNED PRIMARY KEY,
      campaign_id INT NOT NULL,publisher_id INT NOT NULL,pending_amount DECIMAL(24,8) NOT NULL,
      UNIQUE KEY uq_smart_claim_funding_identity(id,campaign_id,publisher_id)) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE channel_reserve_treasury_ledger(id BIGINT UNSIGNED PRIMARY KEY,campaign_id INT,
      entry_type ENUM('allocation_inflow','authorized_funding','advance_outflow','recovery_inflow','quality_bonus_outflow','reversal','adjustment') NOT NULL,
      direction ENUM('in','out') NOT NULL,amount DECIMAL(24,8) NOT NULL) ENGINE=InnoDB`);
    await db.query("INSERT INTO campaigns VALUES(1),(2)");
    await db.query("INSERT INTO users VALUES(10),(11)");
    await db.query("INSERT INTO channel_smart_reach_view_claims VALUES(101,1,10,0.10000000),(102,1,11,0.10000000)");
    await db.query(`INSERT INTO channel_reserve_treasury_ledger VALUES
      (1,1,'allocation_inflow','in',0.01000000),(2,2,'allocation_inflow','in',0.02000000),
      (3,1,'recovery_inflow','in',0.03000000)`);
    migration("db/migrations/20261114_1000_smart_reach_reserve_funding.sql");
    await t.test("exact amount, source identity and claim attribution",async()=>{
      await db.query(`INSERT INTO channel_smart_reach_reserve_fundings
        (reserve_ledger_id,campaign_id,publisher_id,claim_id,committed_amount,idempotency_key,source_financial_ref)
        VALUES(1,1,10,101,0.00987654,'fund:1','reserve-click:1')`);
      const funded=await row(db,"SELECT committed_amount,consumed_amount,status,source_entry_type FROM channel_smart_reach_reserve_fundings");
      assert.equal(funded.committed_amount,"0.00987654");assert.equal(funded.consumed_amount,"0.00000000");
      assert.equal(funded.status,"committed");assert.equal(funded.source_entry_type,"allocation_inflow");
      await db.query(`INSERT INTO channel_smart_reach_reserve_allocations
        (reserve_funding_id,claim_id,campaign_id,publisher_id,amount,idempotency_key,publisher_credit_source_key)
        VALUES(1,101,1,10,0.00987654,'alloc:1','credit:1')`);
      assert.equal((await row(db,"SELECT amount,funding_source FROM channel_smart_reach_reserve_allocations")).funding_source,"collected_reserve");
    });
    await t.test("duplicate funding and allocation keys are rejected",async()=>{
      await assert.rejects(db.query(`INSERT INTO channel_smart_reach_reserve_fundings
        (reserve_ledger_id,campaign_id,publisher_id,claim_id,committed_amount,idempotency_key,source_financial_ref)
        VALUES(1,1,10,101,0.00100000,'fund:1','reserve-click:1')`),/Duplicate/);
      await assert.rejects(db.query(`INSERT INTO channel_smart_reach_reserve_allocations
        (reserve_funding_id,claim_id,campaign_id,publisher_id,amount,idempotency_key,publisher_credit_source_key)
        VALUES(1,101,1,10,0.00100000,'alloc:other','credit:other')`),/Duplicate/);
    });
    await t.test("cross-campaign, wrong publisher, ARR and invalid amounts fail",async()=>{
      const insert=`INSERT INTO channel_smart_reach_reserve_fundings
        (reserve_ledger_id,campaign_id,publisher_id,claim_id,committed_amount,idempotency_key,source_financial_ref)
        VALUES(?,?,?,?,?,?,?)`;
      await assert.rejects(db.query(insert,[2,1,10,101,"0.001","wrong-campaign","x"]));
      await assert.rejects(db.query(insert,[1,1,11,101,"0.001","wrong-publisher","x"]));
      await assert.rejects(db.query(insert,[3,1,10,101,"0.001","arr-source","x"]));
      await assert.rejects(db.query(insert,[1,1,10,101,"0","zero","x"]));
      await assert.rejects(db.query("UPDATE channel_smart_reach_reserve_fundings SET consumed_amount=0.02 WHERE id=1"));
      await assert.rejects(db.query("UPDATE channel_smart_reach_reserve_allocations SET funding_source='advertiser_impression' WHERE id=1"));
    });
    await t.test("guarded rollback refuses financial records and succeeds after fixture removal",async()=>{
      migration("db/migrations/20261114_1000_smart_reach_reserve_funding.down.sql",false);
      assert.equal((await row(db,"SELECT COUNT(*) n FROM channel_smart_reach_reserve_fundings")).n,1);
      await db.query("DELETE FROM channel_smart_reach_reserve_allocations");
      await db.query("DELETE FROM channel_smart_reach_reserve_fundings");
      migration("db/migrations/20261114_1000_smart_reach_reserve_funding.down.sql");
      assert.equal((await row(db,`SELECT COUNT(*) n FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='channel_smart_reach_reserve_fundings'`)).n,0);
    });
  }finally{if(db)await db.end();await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);await admin.end();}
});
