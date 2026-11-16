import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import mysql from 'mysql2/promise';

const supplied=process.env.ADSGALAXY_ACCEPTANCE_TEST_DATABASE_URL;
test('cleanup and live teaser lanes both advance past their first page', {skip:!supplied}, async()=>{
  const url=new URL(supplied);
  assert.equal(url.hostname,'127.0.0.1');
  assert.equal(url.port,'53307');
  assert.equal(url.pathname,'/adsgalaxy_acceptance_test');
  const connection={host:url.hostname,port:Number(url.port),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password)};
  const admin=await mysql.createConnection(connection);
  const schema=`test_teaser_queue_${randomUUID().replaceAll('-','')}`;
  let pool;
  try{
    await admin.query(`CREATE DATABASE \`${schema}\``);
    pool=mysql.createPool({...connection,database:schema,connectionLimit:4});
    await pool.query(`CREATE TABLE campaigns(id INT PRIMARY KEY,status VARCHAR(30),approved_creative_revision_id INT,
      pending_creative_revision_id INT,status_before_creative_review VARCHAR(30),teaser_enabled TINYINT) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE channels(id INT PRIMARY KEY,username VARCHAR(80),channel_type VARCHAR(30),
      tracking_account INT,teaser_enabled TINYINT,teaser_status VARCHAR(30)) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE teaser_placements(id INT PRIMARY KEY,campaign_id INT,channel_id INT,status VARCHAR(30),
      inserted_at DATETIME,removed_at DATETIME,operation_lease_expires_at DATETIME,
      removal_next_retry_at DATETIME,processing_next_retry_at DATETIME,insertion_next_retry_at DATETIME,
      updated_at DATETIME NOT NULL) ENGINE=InnoDB`);
    await pool.query("INSERT INTO campaigns(id,status,teaser_enabled) VALUES(1,'active',1)");
    await pool.query("INSERT INTO channels(id,teaser_enabled,teaser_status) VALUES(1,1,'active')");
    const values=[];
    for(let id=1;id<=60;id++) values.push([id,1,1,id<=30?'failed':'active',id<=30?new Date('2026-11-01T00:00:00Z'):null,new Date('2026-11-01T00:00:00Z')]);
    await pool.query(`INSERT INTO teaser_placements(id,campaign_id,channel_id,status,inserted_at,updated_at)
      VALUES ${values.map(()=>'(?,?,?,?,?,?)').join(',')}`,values.flat());
    const source=readFileSync(new URL('../src/app/api/cron/teaser/route.ts',import.meta.url),'utf8');
    const start=source.indexOf('async function loadTeaserWork()');
    const end=source.indexOf('\nasync function processPlacement',start);
    assert.ok(start>0&&end>start);
    const compiled=ts.transpileModule(`const BATCH=25,CLEANUP_BATCH=15;\n${source.slice(start,end)}\nexports.loadTeaserWork=loadTeaserWork;`,
      {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const module={exports:{}};
    vm.runInNewContext(compiled,{module,exports:module.exports,pool});
    const first=await module.exports.loadTeaserWork();
    assert.equal(first.length,25);
    assert.equal(first.filter(row=>row.status==='failed').length,15);
    assert.equal(first.filter(row=>row.status==='active').length,10);
    for(const row of first){
      if(row.status==='failed')await pool.query("UPDATE teaser_placements SET status='removed' WHERE id=?",[row.id]);
      else await pool.query("UPDATE teaser_placements SET processing_next_retry_at=DATE_ADD(NOW(),INTERVAL 2 MINUTE) WHERE id=?",[row.id]);
    }
    const second=await module.exports.loadTeaserWork();
    assert.equal(second.length,25);
    assert.deepEqual(Array.from(second.filter(row=>row.status==='failed'),row=>Number(row.id)),Array.from({length:15},(_,i)=>i+16));
    assert.deepEqual(Array.from(second.filter(row=>row.status==='active'),row=>Number(row.id)),Array.from({length:10},(_,i)=>i+41));
  }finally{
    if(pool)await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await admin.end();
  }
});
