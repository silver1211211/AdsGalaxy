import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import mysql from 'mysql2/promise';

const raw=process.env.ADSGALAXY_ALLOWANCE_TEST_DATABASE_URL;
if(!raw)throw new Error('isolated_allowance_database_url_required');
const url=new URL(raw);
assert.equal(url.hostname,'127.0.0.1');
assert.equal(url.port,'53307');
assert.equal(url.pathname,'/adsgalaxy_allowance_test');
const config={host:url.hostname,port:Number(url.port),user:decodeURIComponent(url.username),
  password:decodeURIComponent(url.password)};
const schema=`test_phase1_allowance_${randomUUID().replaceAll('-','')}`;
const quote=`\`${schema}\``;
const migration=readFileSync('db/migrations/20261113_1300_standard_cpc_allowance_ledger.sql','utf8');
const down=readFileSync('db/migrations/20261113_1300_standard_cpc_allowance_ledger.down.sql','utf8');
const table='channel_standard_cpc_allowance_ledger';

function rollbackCli(){
  return spawnSync('/usr/bin/mariadb',[
    '--no-defaults',`--host=${config.host}`,`--port=${config.port}`,`--user=${config.user}`,
    `--database=${schema}`],{input:down,encoding:'utf8',
    env:{...process.env,MYSQL_PWD:config.password},timeout:30000});
}

test('isolated Standard CPC allowance migration, ledger and rollback',async t=>{
  const admin=await mysql.createConnection(config);
  let db;
  try{
    await admin.query(`CREATE DATABASE ${quote}`);
    db=await mysql.createConnection({...config,database:schema});
    await db.query("SET SESSION sql_mode='STRICT_ALL_TABLES'");
    await db.query('CREATE TABLE campaigns (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB');
    await db.query('INSERT INTO campaigns(id) VALUES (1),(2)');
    await db.query('CREATE TABLE users (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB');
    await db.query('INSERT INTO users(id) VALUES (1),(2)');
    await t.test('migration creates exact-decimal isolated ledger',async()=>{
      await db.query(migration);
      const [cols]=await db.query(`SELECT COLUMN_NAME,DATA_TYPE,NUMERIC_PRECISION,NUMERIC_SCALE
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
          AND COLUMN_NAME IN ('amount','outstanding_delta') ORDER BY COLUMN_NAME`,[table]);
      assert.equal(cols.length,2);
      for(const col of cols){assert.equal(col.DATA_TYPE,'decimal');assert.equal(col.NUMERIC_PRECISION,24);assert.equal(col.NUMERIC_SCALE,8)}
    });
    const insert=async (campaign,op,amount,delta,system,source,key,reversal=null,advance=null)=>db.query(
      `INSERT INTO ${table}(campaign_id,publisher_id,operation,amount,outstanding_delta,source_system,source_transaction_key,idempotency_key,reverses_entry_id,applies_to_advance_entry_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,[campaign,1,op,amount,delta,system,source,key,reversal,advance]);
    await t.test('revolving balance is campaign-scoped and exact',async()=>{
      const [advance]=await insert(1,'advance','3.00000000','3.00000000','standard_cpc_advance','post:10:views:100','adv:1');
      await insert(1,'recovery','1.00000000','-1.00000000','standard_cpc_arr','click:90','rec:1',null,advance.insertId);
      await insert(1,'advance','3.00000000','3.00000000','standard_cpc_advance','post:11:views:100','adv:2');
      await insert(2,'advance','0.00000001','0.00000001','standard_cpc_advance','post:12:views:1','adv:3');
      const [rows]=await db.query(`SELECT campaign_id,
        CAST(SUM(CASE WHEN operation='advance' THEN amount ELSE 0 END) AS CHAR) issued,
        CAST(SUM(outstanding_delta) AS CHAR) outstanding,
        CAST(5.00000000-SUM(outstanding_delta) AS CHAR) capacity
        FROM ${table} GROUP BY campaign_id ORDER BY campaign_id`);
      assert.deepEqual(rows.map(x=>[x.campaign_id,x.issued,x.outstanding,x.capacity]),[
        [1,'6.00000000','5.00000000','0.00000000'],
        [2,'0.00000001','0.00000001','4.99999999']]);
    });
    await t.test('duplicate operation and source transaction are rejected',async()=>{
      await assert.rejects(insert(1,'advance','0.10000000','0.10000000','standard_cpc_advance','post:13','adv:1'));
      await assert.rejects(insert(1,'advance','0.10000000','0.10000000','standard_cpc_advance','post:10:views:100','adv:other'));
    });
    await t.test('reserve entries, negative amounts and wrong signs are rejected',async()=>{
      await assert.rejects(insert(1,'recovery','1','-1','reserve_allocation','reserve:1','bad:reserve'));
      await assert.rejects(insert(1,'advance','-1','-1','standard_cpc_advance','bad:negative','bad:negative'));
      await assert.rejects(insert(1,'recovery','1','1','standard_cpc_arr','bad:sign','bad:sign'));
      await assert.rejects(insert(1,'advance','0','0','standard_cpc_advance','bad:zero','bad:zero'));
    });
    await t.test('partial reversals share a valid same-campaign original',async()=>{
      const [recovery]=await db.query(`SELECT id FROM ${table} WHERE idempotency_key='rec:1'`);
      await insert(1,'reversal','0.40000000','0.40000000','standard_cpc_reversal','reversed-click:90:a','rev:1',recovery[0].id);
      await insert(1,'reversal','0.60000000','0.60000000','standard_cpc_reversal','reversed-click:90:b','rev:2',recovery[0].id);
      await assert.rejects(insert(1,'reversal','1','1','standard_cpc_reversal','reversed-click:92','rev:3',999999));
      await assert.rejects(insert(2,'reversal','1','1','standard_cpc_reversal','reversed-click:93','rev:4',recovery[0].id));
    });
    await t.test('rollback refuses to erase financial entries',async()=>{
      const result=rollbackCli();assert.notEqual(result.status,0);
      assert.match(result.stderr,/allowance_ledger_not_empty/);
      const [rows]=await db.query(`SELECT COUNT(*) n FROM ${table}`);assert.equal(rows[0].n,6);
    });
    await t.test('empty-ledger rollback removes only the new table',async()=>{
      await db.query(`DELETE FROM ${table} WHERE operation='reversal'`);
      await db.query(`DELETE FROM ${table} WHERE operation='recovery'`);
      await db.query(`DELETE FROM ${table}`);
      const result=rollbackCli();assert.equal(result.status,0,result.stderr);
      const [rows]=await db.query(`SELECT COUNT(*) n FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`,[table]);assert.equal(rows[0].n,0);
      const [campaigns]=await db.query('SELECT COUNT(*) n FROM campaigns');assert.equal(campaigns[0].n,2);
    });
  }finally{
    if(db)await db.end();
    await admin.query(`DROP DATABASE IF EXISTS ${quote}`);
    await admin.end();
  }
});
